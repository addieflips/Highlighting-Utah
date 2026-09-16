/*
 * THE WIRE COLOUR DROPDOWN, IN THE REAL PORTAL
 *
 * Found reviewing the member-portal auto-reply, 2026-09-16, and it is older than that
 * feature by a long way.
 *
 * The Changes tab prefilled this select with `addrDoc.wireColor || 'White'`, and the save
 * read the select back with no fallback. `wireColor` is one of the three
 * WAREHOUSE_BUILD_FIELDS, so whatever this control reads at save time can queue a bundle
 * rebuild. Two silent faults came out of that, measured by running warehouseRebuildFields
 * rather than reasoned about:
 *
 *   - A customer with NO wire colour on file — rbNormalizeWire returns '' for anything the
 *     master sheet spelt oddly — opened this tab to change their NOTE, and the save wrote
 *     'White'. A colour nobody chose, a rebuild nobody asked for, and once the auto-reply
 *     is switched on, an email telling them their wire colour had changed.
 *   - A record holding a wire the select cannot show fell to selectedIndex -1, so the save
 *     wrote '' and ERASED it — rebuild and all. That one is data loss.
 *
 * The radios directly below this select already avoid exactly this: an untouched control
 * must never read as a change, so nothing is checked when nothing is recorded and the save
 * falls back to the record. This brings the select to the same rule.
 *
 * ⚠ WHY A BROWSER SPEC. Every claim here is about what a <select> DOES — what it displays
 * for a value that is not one of its options, and what .value reads back. A source check
 * cannot see selectedIndex -1, and it is precisely that behaviour that erased the field.
 * This repo's oldest lesson, paid for by the Add Folder Enter key, the Use-it button and
 * the recycle "bin says" box: a line in the source is not a control on the screen.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const BLOCKED = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

async function openChanges(page, wireColor) {
  /* ⚠ THE OVERRIDE IS `customers`, KEYED BY FIXTURE NAME — the stub merges whole customer
     entries, not bare records, and passing `record` silently changes nothing and leaves the
     standard fixture's own 'White' in place. Which is how the first run of this file
     "passed" two checks against a customer it was not testing. */
  const stub = await installFirebaseStub(page, {
    customers: {
      standard: Object.assign({}, CUST, {
        record: Object.assign({}, CUST.record, { wireColor: wireColor })
      })
    }
  });
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await page.locator('.portal-tab-btn[data-tab="changes"]').click();
  stub.thrown = thrown;
  return stub;
}

/** What the page actually posted for wireColor on the last portalSave. */
async function savedWire(stub) {
  const calls = await stub.calls();
  const saves = calls.filter(c => c.name === 'portalSave');
  expect(saves.length).toBeGreaterThan(0);
  return (saves[saves.length - 1].payload.data || {}).wireColor;
}

test.describe('The wire colour dropdown', () => {
  /* ⛔ THE BUG. Nothing is recorded, the customer touches only their note, and the save
     must not invent a colour. Before the fix this posted 'White'. */
  test('a customer with none on file does not get one invented for them', async ({ page }) => {
    const stub = await openChanges(page, '');
    await expect(page.locator('#wireColorSelect')).toHaveValue('');
    await page.locator('#changesNotes').fill('Please ring before you come');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    expect(await savedWire(stub)).toBe('');
    expect(stub.thrown).toEqual([]);
  });

  /* ⛔ AND THE DATA-LOSS DIRECTION. The office holds a wire this select has no option for,
     so the select shows nothing — and the save must leave the record's value alone rather
     than writing the blank back over it. */
  test('a wire colour the dropdown cannot show is never erased by an unrelated save', async ({ page }) => {
    const stub = await openChanges(page, 'Brown');
    await expect(page.locator('#wireColorSelect')).toHaveValue('');
    await page.locator('#changesNotes').fill('Gate sticks, give it a shove');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    expect(await savedWire(stub)).toBe('Brown');
    expect(stub.thrown).toEqual([]);
  });

  /* ⚠ AND THE ORDINARY CASE STILL WORKS BOTH WAYS, or "never write anything" would pass
     the two checks above while making the control useless. */
  test('a recorded colour is shown and survives a save', async ({ page }) => {
    const stub = await openChanges(page, 'Green');
    await expect(page.locator('#wireColorSelect')).toHaveValue('Green');
    await page.locator('#changesNotes').fill('anything');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    expect(await savedWire(stub)).toBe('Green');
    expect(stub.thrown).toEqual([]);
  });

  test('and choosing one really does save it', async ({ page }) => {
    const stub = await openChanges(page, '');
    await page.locator('#wireColorSelect').selectOption('Green');
    await page.locator('#changesSaveBtn').click();
    await expect(page.locator('#changesSaveStatus')).toHaveText(/saved/i);
    expect(await savedWire(stub)).toBe('Green');
    expect(stub.thrown).toEqual([]);
  });

  /* ⚠ THE PLACEHOLDER IS WHAT LETS THIS SELECT BE HONEST, and it must stay unchoosable —
     otherwise a customer can blank a wire colour the office really does hold, which is the
     erasure above with a person's finger on it instead of a prefill. */
  test('the "not recorded" placeholder cannot be chosen by a customer', async ({ page }) => {
    await openChanges(page, 'Green');
    await expect(page.locator('#wireColorSelect option[value=""]')).toBeDisabled();
  });
});
