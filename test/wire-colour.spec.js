/*
 * THE WIRE COLOUR IS NOT ASKED OF A CUSTOMER, AND CANNOT BE WRITTEN BY ONE
 *
 * Addie, 2026-09-17: "keep what lights they want but don't add what wire color they want
 * but push check lights then warehouse chooses what wire they have on file and will make
 * it based on what wire they have."
 *
 * ⭐ AND THE QUESTION CAME BACK THE NEXT DAY, ON A DIFFERENT TAB ([[OPT-21]], 2026-09-18).
 * Addie: "we instruct them to pick based on gutter color however this is completley optional
 * and they can choose Any. Which will mean we choose." What 2026-09-17 refused was never the
 * question — it was the INVENTED ANSWER: the old select defaulted to Any and then STORED it.
 * The new control is on the LIGHTS tab, Any is the default, and Any writes nothing at all.
 *
 * ⛔ SO THIS FILE IS ABOUT THE CHANGES TAB, and every claim in it still holds: a customer who
 * came here to edit a NOTE must not touch their wire colour, not invent one and not erase
 * one. That guarantee is what outlived the old control and it outlives this reversal too.
 * The new control has its own coverage at the bottom of this file.
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
       check above while asking the same question.
       ⛔ SCOPED TO THIS PANEL ([[OPT-21]], 2026-09-18). It read the WHOLE PAGE until the wire
       question came back on the LIGHTS tab — getByText counts hidden elements too, so the
       new control on another panel failed this one. The claim was always about the Changes
       tab; it now says so, which is narrower and truer than what it replaced rather than
       weaker. The Changes tab is still where somebody edits a note, and a note is still not
       a wire colour. */
    await expect(page.locator('#tabPanel-changes').getByText(/wire colou?r/i)).toHaveCount(0);
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

/* ==========================================================================
   AND THE QUESTION THEY CAN ANSWER, ON THE LIGHTS TAB ([[OPT-21]], 2026-09-18)

   Addie: "we instruct them to pick based on gutter color however this is completley optional
   and they can choose Any. Which will mean we choose."

   ⚠ A BROWSER SPEC AND NOT A SOURCE CHECK, because the two things that can go wrong here are
   both invisible from the source and both have happened in this repo before: a control that
   renders and saves nothing, and a default that quietly writes itself onto a record. Suite
   340 proves the markup and the server guard; only this can say what the page POSTS.
   ========================================================================== */
test.describe('The wire colour they can answer, from their gutter', () => {
  async function openLights(page) {
    const stub = await installFirebaseStub(page);
    const thrown = [];
    page.on('pageerror', e => thrown.push('pageerror: ' + e));
    page.on('console', m => { if (m.type() === 'error' && !BLOCKED.test(m.text())) thrown.push('console: ' + m.text()); });
    /* ⚠ A REAL COLOUR CHANGE ASKS BEFORE IT SAVES — the picker warns about replacing what
       is on file, and about the $30 outside the free window. Playwright DISMISSES a dialog
       by default, which cancels the save and leaves the status line empty, so the test reads
       as a broken save rather than as an unanswered question. Accepting is what the customer
       does. Registered before the first click, or the dialog that fires during it is missed. */
    page.on('dialog', d => d.accept());
    await page.goto(`/index.html#/payment?token=${CUST.token}`);
    await page.locator('.portal-tab-btn[data-tab="lights"]').click();
    stub.thrown = thrown;
    return stub;
  }

  test('the control is there, and it opens on Any', async ({ page }) => {
    await openLights(page);
    const sel = page.locator('#rcWireColor');
    await expect(sel).toBeVisible();
    /* ⛔ ANY IS WHERE SOMEBODY WHO READS NOTHING LANDS. That is the whole of what 2026-09-17
       refused: the old box defaulted to a real colour and then stored it. */
    await expect(sel).toHaveValue('');
  });

  /* ⚠ THE INSTRUCTION IS THE RULING, not the control. Without it this is just the box that
     was deliberately removed, put back. */
  test('it tells them to match their gutter', async ({ page }) => {
    await openLights(page);
    await expect(page.locator('#tabPanel-lights').getByText(/gutter/i).first()).toBeVisible();
  });

  /* ⛔ ANY POSTS NOTHING AT ALL. Not an empty string, not the word — the field must be absent,
     because a blank would WIPE a colour the warehouse read off a photo of the house. */
  test('leaving it on Any sends no wire colour', async ({ page }) => {
    const stub = await openLights(page);
    /* ⚠ THE SWATCH A CUSTOMER ACTUALLY PRESSES. `.rc-swatch` lives inside the pattern
       builder, which is display:none until the specific-pattern box is ticked — so clicking
       it times out on an element that exists and cannot be seen. */
    await page.locator('.rc-simple-swatch[data-color="Red"]').click();
    await page.locator('#lightsSaveBtn').click();
    await expect(page.locator('#lightsSaveStatus')).toHaveText(/saved/i);
    const data = await lastSave(stub);
    expect('wireColor' in data).toBe(false);
    expect(stub.thrown).toEqual([]);
  });

  /* ⭐ AND A REAL CHOICE REACHES THE RECORD, which is the half that makes the control worth
     having at all. */
  test('picking Green sends Green', async ({ page }) => {
    const stub = await openLights(page);
    await page.locator('#rcWireColor').selectOption('Green');
    /* ⛔ AND NOTHING ELSE IS TOUCHED, DELIBERATELY. This is the commonest use of the control
       — somebody opens Lights only to match their gutter — and it is the case the first
       draft got wrong: wirePick was computed BELOW the nothing-changed guard, so the save
       returned "Nothing changed" and the wire never went. Clicking a colour here as well
       would have hidden that, because the colours changing carries the save on its own. */
    await page.locator('#lightsSaveBtn').click();
    await expect(page.locator('#lightsSaveStatus')).toHaveText(/saved/i);
    const data = await lastSave(stub);
    expect(data.wireColor).toBe('Green');
    expect(stub.thrown).toEqual([]);
  });
});
