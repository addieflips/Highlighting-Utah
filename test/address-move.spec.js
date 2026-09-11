/*
 * MOVING HOUSE, IN THE REAL PORTAL
 *
 * Addie, 2026-09-10: "changing gate code or phone number should not notify us",
 * and "you should have to apply changes in order for it to go to requote."
 *
 * ⚠ WHY A BROWSER SPEC AND NOT ONLY address-move.test.js. That gate RUNS the
 * callable and reads its update object, which proves the server applies nothing —
 * and proves nothing at all about whether a customer can reach the form. This
 * repo's oldest lesson is that a message in the source is not a message on the
 * screen, and it has been paid for repeatedly: the Add Folder input that really
 * did work except for the Enter key, the Use-it button destroyed between mousedown
 * and mouseup, the recycle "bin says" box whose listener silently never applied.
 * Every one of those was green in source checks.
 *
 * ⚠ AND THE CENTRAL CLAIM IS VISIBLE HERE IN A WAY IT IS NOWHERE ELSE: after the
 * form is sent, the address box still shows the OLD house. That is deliberate —
 * the office has not applied it — and it is exactly the state a customer would
 * otherwise read as the form having failed, which is what the banner is for.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

async function openPortal(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await page.locator('.portal-tab-btn[data-tab="info"]').click();
  stub.thrown = thrown;
  return stub;
}

test.describe('Telling the portal you have moved', () => {
  test('the offer is on My Info, and the form is folded away until asked for', async ({ page }) => {
    const stub = await openPortal(page);
    await expect(page.locator('#infoMovedNote')).toBeVisible();
    /* ⚠ SHUT BY DEFAULT. Four extra boxes open on a tab somebody came to for their
       phone number is how a form gets filled in by accident. */
    await expect(page.locator('#infoMovedForm')).toBeHidden();
    expect(stub.thrown).toEqual([]);
  });

  test('the link opens it, and opens it on the street box', async ({ page }) => {
    await openPortal(page);
    await page.locator('#infoMovedLink').click();
    await expect(page.locator('#infoMovedForm')).toBeVisible();
    await expect(page.locator('#movedStreet')).toBeFocused();
  });

  test('and folds it away again, for somebody who clicked by accident', async ({ page }) => {
    await openPortal(page);
    await page.locator('#infoMovedLink').click();
    await page.locator('#infoMovedLink').click();
    await expect(page.locator('#infoMovedForm')).toBeHidden();
  });

  /* ⚠ THE REFUSAL IS NAMED, NOT SILENT. The server refuses this too, but a customer
     who presses the button and sees nothing happen assumes it is broken. */
  test('a street with no town says which box, rather than failing quietly', async ({ page }) => {
    const stub = await openPortal(page);
    await page.locator('#infoMovedLink').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedSaveBtn').click();
    await expect(page.locator('#movedSaveStatus')).toContainText(/street and the town/i);
    /* Nothing was sent, so nothing can have been recorded. */
    await expect(page.locator('#infoMovePending')).toBeHidden();
    expect(stub.thrown).toEqual([]);
  });

  test('sending it shows what the office now has, and folds the offer away', async ({ page }) => {
    const stub = await openPortal(page);
    await page.locator('#infoMovedLink').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedCity').fill('Springville');
    await page.locator('#movedZip').fill('84663');
    await page.locator('#movedDate').fill('mid-October');
    await page.locator('#movedSaveBtn').click();

    const pending = page.locator('#infoMovePending');
    await expect(pending).toBeVisible();
    await expect(pending).toContainText('9 Oak St, Springville 84663');
    await expect(pending).toContainText(/mid-October/);
    /* ⚠ THE OFFER GOES, AND THIS IS THE POINT OF THE BANNER. A second submission is
       the failure it exists to prevent, and the surest way to invite one is to leave
       the button sitting there looking unused. */
    await expect(page.locator('#infoMovedForm')).toBeHidden();
    await expect(page.locator('#infoMovedNote')).toBeHidden();
    expect(stub.thrown).toEqual([]);
  });

  /* ⭐ THE CLAIM THE NODE GATE CANNOT SHOW: the live address is untouched. */
  test('the address on file is still the OLD house, and the page says why', async ({ page }) => {
    await openPortal(page);
    const before = await page.locator('#infoAddress').inputValue();
    await page.locator('#infoMovedLink').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedCity').fill('Springville');
    await page.locator('#movedSaveBtn').click();
    await expect(page.locator('#infoMovePending')).toBeVisible();
    /* Unchanged — the office applies it, and until then the pin, the town and any
       frozen route stop still belong to this address. */
    await expect(page.locator('#infoAddress')).toHaveValue(before);
    await expect(page.locator('#infoMovePending')).toContainText(/still showing the old address/i);
  });

  /* ⚠ A RETURNING VISIT IS THE CASE THE WIRING BREAKS ON. The banner is drawn from
     the record when the account loads, and deleting that one call leaves every
     behavioural check above green while a customer who already sent their address
     sees the old one with nothing saying why — and sends it again. */
  test('a customer who already sent it is told so on their next visit', async ({ page }) => {
    const withPending = JSON.parse(JSON.stringify(CUSTOMERS));
    withPending.standard.record.pendingAddress = '9 Oak St, Springville 84663';
    withPending.standard.record.pendingMoveDate = 'mid-October';
    await openPortal(page, { customers: withPending });
    await expect(page.locator('#infoMovePending')).toBeVisible();
    await expect(page.locator('#infoMovePending')).toContainText('9 Oak St, Springville 84663');
    await expect(page.locator('#infoMovedNote')).toBeHidden();
  });

  /* ⭐ THE SECOND DOOR. Somebody who has moved lands on Cancel looking for the way
     out, and a mover who cancels is a customer lost who did not need to be. */
  test('the Cancel tab offers the move form instead, and opens it', async ({ page }) => {
    await openPortal(page);
    await page.locator('.portal-tab-btn[data-tab="cancel"]').click();
    const offer = page.locator('#cancelMovedLink');
    await expect(offer).toBeVisible();
    await offer.click();
    /* It offers and never diverts: it lands on the form, open. */
    await expect(page.locator('#tabPanel-info')).toBeVisible();
    await expect(page.locator('#infoMovedForm')).toBeVisible();
  });

  test('and the Cancel button itself is untouched by that offer', async ({ page }) => {
    await openPortal(page);
    await page.locator('.portal-tab-btn[data-tab="cancel"]').click();
    /* Somebody trying to LEAVE must never be told to do something else first —
       portalSave exempts `section === 'cancel'` from the arrears hold by name for
       the same reason. */
    await expect(page.locator('#cancelFinalBtn')).toBeVisible();
    await expect(page.locator('#cancelFinalBtn')).toBeEnabled();
  });

  /* ⭐ THE OFFICE IS EMAILED, NOT ONLY LEFT AN INBOX NOTE (2026-09-11, MSG-17/MSG-18).
     Addie: "lets just send everything to gmail that has to do with member portal, or
     Send Message or contact", and errors and system messages stay in the Inbox.

     ⚠ WHY THIS IS A BROWSER CHECK AND NOT A SOURCE ONE. The call sits inside the try,
     after an await — so whether it RUNS depends on the server having said yes, which no
     grep can see. It is also the exact shape this repo has shipped broken before: a
     handler present in the source that never fires. And the alert is the whole of how
     the office finds out today, since nothing polls the Inbox.

     ⚠ NOTHING IS EMAILED ANYWHERE. api.emailjs.com stays forbidden; the stub serves a
     fake SDK that records and resolves locally, and assertNoRealCalls still runs. */
  test('a move emails the office, with the new address in it', async ({ page }) => {
    const stub = await openPortal(page, { emailAlerts: true });
    await page.locator('#infoMovedLink').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedCity').fill('Springville');
    await page.locator('#movedDate').fill('mid-October');
    await page.locator('#movedSaveBtn').click();
    await expect(page.locator('#infoMovePending')).toBeVisible();

    const alerts = await stub.alerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].params.topic).toBe('Existing Customer - Address Changed');
    /* The office has to be able to act on it without opening the dashboard first. */
    expect(alerts[0].params.message).toContain('9 Oak St, Springville');
    expect(alerts[0].params.message).toContain('mid-October');
    expect(alerts[0].params.customer_name).toBeTruthy();
    stub.assertNoRealCalls();
    expect(stub.thrown).toEqual([]);
  });

  /* ⛔ AND THE ORDINARY SAVE STILL SENDS NOTHING. This is the regression guard the
     change most needs and did not have: the My Info save was deliberately stopped from
     notifying on 2026-09-10 — "changing gate code or phone number should not notify us"
     — because a corrected street spelling is not a move and comparing two typed strings
     cannot tell them apart. Moving the new call up into that handler would look like a
     tidy-up and would undo that fix, with nothing anywhere going red. Now something does. */
  test('but saving My Info emails nobody, however much changed', async ({ page }) => {
    const stub = await openPortal(page, { emailAlerts: true });
    await page.locator('#infoPhone').fill('801 555 0142');
    await page.locator('#infoGateCode').fill('4412');
    await page.locator('#infoSaveBtn').click();
    await expect(page.locator('#infoSaveStatus')).not.toHaveText('');

    expect(await stub.alerts()).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ AND A FAILED CALL READS AS A FAILURE. portalCallFailedText is the one funnel
     every portal failure goes through, so a new path added later reports itself —
     but only if it actually calls it. */
  test('a server failure says so, and claims nothing was saved', async ({ page }) => {
    const forced = JSON.parse(JSON.stringify(CUSTOMERS));
    forced.standard.token = 'forcemovefail';
    await installFirebaseStub(page, { customers: forced });
    await page.goto('/index.html#/payment?token=forcemovefail');
    await page.locator('.portal-tab-btn[data-tab="info"]').click();
    await page.locator('#infoMovedLink').click();
    await page.locator('#movedStreet').fill('9 Oak St');
    await page.locator('#movedCity').fill('Springville');
    await page.locator('#movedSaveBtn').click();
    await expect(page.locator('#movedSaveStatus')).toContainText(/901-0011/);
    await expect(page.locator('#infoMovePending')).toBeHidden();
  });
});
