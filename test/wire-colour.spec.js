/*
 * THE WIRE COLOUR IS NOT ASKED OF A CUSTOMER, AND CANNOT BE WRITTEN BY ONE
 *
 * Addie, 2026-09-17: "keep what lights they want but don't add what wire color they want
 * but push check lights then warehouse chooses what wire they have on file and will make
 * it based on what wire they have."
 *
 * ⚠ THIS FILE USED TO TEST THE DROPDOWN ITSELF, and that control is gone. It is rewritten
 * rather than repaired, for the reason CLAUDE.md records about quote-card.test.js: a test
 * describing a design that has been replaced is not broken-but-correct, it is describing
 * something that no longer exists. What is KEPT is the guarantee underneath it, which
 * outlived the control — a customer editing their note must never change their wire colour.
 *
 * THE HISTORY, because it is why the guarantee is worth a browser spec at all. That select
 * was prefilled `addrDoc.wireColor || 'White'` and read back on save with no fallback, and
 * `wireColor` is one of the three WAREHOUSE_BUILD_FIELDS — so whatever it read could queue a
 * bundle rebuild. Two silent faults came out of it: a customer with nothing on file who
 * opened this tab to change their NOTE had 'White' written to their record, and a record
 * holding a wire the select could not show fell to `selectedIndex -1` and was ERASED. Both
 * were fixed on 2026-09-16 ([[OPT-11]]); the question was removed outright the next day.
 *
 * ⚠ AND IT IS STILL A BROWSER SPEC, not a source check. "There is no such control" and "the
 * save posts no such field" are both claims about what the real page DOES, and this repo has
 * been caught three times by a source check passing over a control that could never run.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

async function openChanges(page) {
  /* ⛔ NOTHING TO OVERRIDE ANY MORE, and that is the point: `wireColor` is no longer in
     PORTAL_READ_FIELDS, so the browser is never handed one whatever the record says. The
     earlier version of this helper took a colour and pushed it into the fixture, which was
     the only way to test a control that prefilled itself from it. */
  const stub = await installFirebaseStub(page);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await page.locator('.portal-tab-btn[data-tab="changes"]').click();
  stub.thrown = thrown;
  return stub;
}

/** The data object the page actually posted on the last portalSave. */
async function lastSave(stub) {
  const calls = await stub.calls();
  const saves = calls.filter(c => c.name === 'portalSave');
  expect(saves.length).toBeGreaterThan(0);
  return saves[saves.length - 1].payload.data || {};
}

test.describe('The wire colour is ours, not theirs', () => {
  test('there is no wire colour control on the Changes tab at all', async ({ page }) => {
    await openChanges(page);
    await expect(page.locator('#wireColorSelect')).toHaveCount(0);
    /* ⚠ AND NOT BY ANY OTHER NAME. A control renamed rather than removed would pass the
       check above while asking the same question. */
    await expect(page.getByText(/wire colou?r/i)).toHaveCount(0);
  });

  /* ⛔ THE GUARANTEE THAT OUTLIVED THE CONTROL. A customer who came here to change their
     note must not touch their wire colour — not invent one, not erase one. It is now true
     by construction rather than by a fallback, and this is what proves the construction. */
  test('a save from this tab carries no wire colour, for a customer who has none', async ({ page }) => {
    const stub = await openChanges(page);
    await page.locator('#changesNotes').fill('Please ring before you come');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    const data = await lastSave(stub);
    expect('wireColor' in data).toBe(false);
    expect(stub.thrown).toEqual([]);
  });

  /* ⛔ AND THE BROWSER IS NEVER GIVEN ONE TO SEND BACK — wireColor left PORTAL_READ_FIELDS
     with the control, so the page could not return one even if it tried. That claim is NOT
     tested here, deliberately, and this note is where the next person looks for it:
     `portal-fields.test.js` already fails the build on any whitelisted field the portal does
     not read, which is the same guarantee from the side that can actually see the whitelist.
     ⚠ TWO DRAFTS OF IT LIVED HERE AND BOTH WERE WORTHLESS. The first read the stub's call
     log, which records `{name, payload}` and no RESULT — so it compared an empty string and
     passed whatever the server sent. The second read `window.currentJobAddressData`, which
     does not exist: index.html's portal script is ONE ES MODULE, so a top-level `var` is
     module-scoped and never reaches `window`. A browser is the wrong instrument for this
     one; §9.1's rule is not to duplicate a check across the three systems anyway. */

  /* ⚠ THE NO-REGRESSION HALF. "Send nothing at all" would pass both checks above while
     breaking the tab, so the fields this form is still FOR must still arrive. */
  test('everything the tab is still for still saves', async ({ page }) => {
    const stub = await openChanges(page);
    await page.locator('#schedSelect').selectOption('October');
    await page.locator('#changesNotes').fill('Back gate, not the front');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    const data = await lastSave(stub);
    expect(data.installPreference).toBe('October');
    expect(data.notes).toBe('Back gate, not the front');
    expect(stub.thrown).toEqual([]);
  });

  /* ⛔ AND THE LIGHT COLOURS ARE UNTOUCHED. Her sentence begins "keep what lights they
     want" — the cord is ours to choose and the bulbs are not, and a change that quietly
     took both away would be the opposite of what was asked for. */
  test('the light colours are still theirs to change', async ({ page }) => {
    await openChanges(page);
    /* ⚠ PINNED TO THE CONTROL THAT EXISTS, not an or-list — a three-way selector passes on
       whichever one happens to be there and would go on passing if the real one left. */
    await expect(page.locator('.portal-tab-btn[data-tab="lights"]')).toBeVisible();
  });
});
