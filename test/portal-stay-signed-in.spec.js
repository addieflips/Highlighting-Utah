/*
 * STAYING SIGNED IN, AND STILL BEING ABLE TO LEAVE  ([[MEM-01]])
 *
 * Addie, 2026-09-11: "make sure when someone logs into member portal they stay
 * logged in but they can still go back to home page with a go back button or
 * something in top right corner."
 *
 * ⚠ WHY THIS IS A BROWSER SPEC AND COULD NOT BE ANYTHING ELSE. Every claim below
 * is either about a control being on the screen or about what survives a RELOAD,
 * and a reload is the one thing no node gate can stage: the start-up block this
 * change touches runs once per page load, so a `goto` that only changes the hash
 * never re-runs it. That is not a hypothetical — the first diagnostic written for
 * this reported the redirect as already fixed for exactly that reason, and it was
 * `page.reload()` that showed it firing.
 *
 * ⚠ AND THE SIGN-IN HALF WAS ALREADY TRUE. Driving it first is what established
 * that: the token survives the way back and the header button walks straight in.
 * The tests for that half are kept anyway — it is the half she asked for by name,
 * and nothing else in the suite holds it.
 */
const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const CUST = CUSTOMERS.standard;

async function signIn(page) {
  const stub = await installFirebaseStub(page, {});
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`/index.html#/payment?token=${CUST.token}`);
  await page.locator('#portalTabsLayout').waitFor({ state: 'visible', timeout: 15000 });
  stub.errs = errs;
  return stub;
}

const token = (page) => page.evaluate(() => {
  try { return localStorage.getItem('huPortalToken'); } catch (e) { return null; }
});

test.describe('The member portal keeps them signed in, and still lets them out', () => {

  test('the way back is in the top right, beside Log Out', async ({ page }) => {
    const stub = await signIn(page);
    const back = page.locator('#portalBackToSiteLink');
    await expect(back).toBeVisible();

    /* ⚠ "Top right" is the claim, so it is MEASURED rather than assumed from the
       markup order — the row is a flex container and a CSS change is exactly how a
       control ends up somewhere else while every source check still passes. */
    const box = await back.boundingBox();
    const card = await page.locator('#invoiceCard').boundingBox();
    expect(box.x + box.width / 2, 'the way back sits in the right-hand half of the card')
      .toBeGreaterThan(card.x + card.width / 2);

    /* ⚠ AND IT READS BEFORE Log Out, which is the one control next to it that cannot
       be undone. */
    const out = await page.locator('#portalLogoutLink').boundingBox();
    expect(box.x, 'the way back comes before Log Out').toBeLessThan(out.x);
    stub.assertNoRealCalls();
  });

  test('pressing it reaches the home page and does NOT sign them out', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await expect(page.locator('#page-home')).toHaveClass(/active/);
    expect(await token(page), 'the way back is not a log out').toBe(CUST.token);
    stub.assertNoRealCalls();
  });

  test('and the header walks them straight back in, with no second sign-in', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await expect(page.locator('#page-home')).toHaveClass(/active/);
    await page.locator('a.btn[href="#/payment"]').first().click();
    await expect(page.locator('#portalTabsLayout')).toBeVisible();
    await expect(page.locator('#lookupFormWrap')).toBeHidden();
    stub.assertNoRealCalls();
  });

  /* ⭐ THE ONE THAT WAS ACTUALLY BROKEN. A remembered login redirects the bare site
     to #/payment at start-up, so a customer who had just asked for the home page was
     put back into their account by the next refresh. */
  test('a reload on the home page leaves them on the home page', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await expect(page.locator('#page-home')).toHaveClass(/active/);

    await page.reload();
    await page.waitForTimeout(1200);
    await expect(page.locator('#page-home'), 'they asked for the site; a refresh must not overrule that')
      .toHaveClass(/active/);
    expect(await token(page), 'and they are still signed in').toBe(CUST.token);
    stub.assertNoRealCalls();
  });

  /* ⛔ THE OTHER HALF OF HER SENTENCE, and the thing the fix must not break: a
     refresh INSIDE the account still comes back signed in. */
  test('but a reload inside the portal still comes back signed in', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await page.locator('a.btn[href="#/payment"]').first().click();
    await expect(page.locator('#portalTabsLayout')).toBeVisible();

    await page.reload();
    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#lookupFormWrap')).toBeHidden();
    stub.assertNoRealCalls();
  });

  /* ⚠ AND THE SAME CLAIM WITH THE NOTE STILL SET — staged by hand, and it has to be.
     The test above cannot reach this state and a red-check proved it: walking back into
     the portal CLEARS the note, so by the time it reloads both a correct guard and one
     written over both branches behave identically, and a sabotage moving `!wantsSite`
     outside the brackets went straight through it. There is no click path that leaves
     the note set on a bare #/payment, which is exactly why the invariant has to be
     staged rather than acted out: what must be true is that the note suppresses the
     redirect AWAY FROM THE SITE and nothing else, whatever else is going on. */
  test('a set note never suppresses the sign-in on the portal page itself', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await page.locator('a.btn[href="#/payment"]').first().click();
    await expect(page.locator('#portalTabsLayout')).toBeVisible();

    await page.evaluate(() => { try { sessionStorage.setItem('huPortalStayOnSite', '1'); } catch (e) {} });
    await page.reload();
    await expect(page.locator('#portalTabsLayout'),
      'a bare #/payment is somebody asking for their account — the note must not answer for them')
      .toBeVisible({ timeout: 15000 });
    await expect(page.locator('#lookupFormWrap')).toBeHidden();
    stub.assertNoRealCalls();
  });

  /* ⚠ ASKING FOR THE PORTAL TAKES THE NOTE BACK. Without it one press would stand the
     redirect down for the rest of the tab, including after they walked back in. */
  test('walking back into the portal restores the landing redirect', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalBackToSiteLink').click();
    await page.locator('a.btn[href="#/payment"]').first().click();
    await expect(page.locator('#portalTabsLayout')).toBeVisible();

    const flag = await page.evaluate(() => {
      try { return sessionStorage.getItem('huPortalStayOnSite'); } catch (e) { return 'blocked'; }
    });
    expect(flag, 'entering the portal clears "leave me on the site"').toBeNull();
    stub.assertNoRealCalls();
  });

  test('Log Out is still a log out', async ({ page }) => {
    const stub = await signIn(page);
    await page.locator('#portalLogoutLink').click();
    await page.waitForTimeout(1200);
    expect(await token(page), 'Log Out must still clear the remembered login').toBeNull();
    stub.assertNoRealCalls();
  });
});
