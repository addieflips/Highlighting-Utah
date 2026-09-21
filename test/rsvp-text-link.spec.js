/*
 * The text-message RSVP — one link, three answers
 *
 * Addie, 2026-09-21: "We need to send out a text message RSVP which means we need one
 * link which will take people to a page that says Yes, Back Next year and No."
 *
 * ⭐ WHY THESE ARE BROWSER SPECS. Every claim here is about WHAT IS ON THE SCREEN after
 * somebody taps a link in a text, and about a call that must NOT happen until they pick
 * an answer — which is the one thing a regex over index.html cannot see at all. The bug
 * that produced this repo's sibling file was a single wrong class name in the router:
 * every handler, message and button was present and correct in the source, and the
 * customer still landed on the new-customer install-details form.
 *
 * ⚠ THE REWRITE IS SIMULATED, exactly as test/quote-link.spec.js does for /q/ and /r/.
 * The test server is a plain static file server and would 404 on /a/, so the spec
 * answers that path with index.html the way Netlify does. The path-to-hash mapping
 * itself is proved in rsvp-text-link.test.js, which runs the shipped reader's own
 * pattern against the address admin.html builds.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

const INDEX = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'index.html'), 'utf8');
const TOKEN = CUSTOMERS.standard.token;

/* Opens the real short link. Nothing is tapped — picking an answer is the caller's
   job here, which is the whole difference between this page and the email's links. */
async function openTextLink(page) {
  const stub = await installFirebaseStub(page);
  const thrown = [];
  page.on('pageerror', e => thrown.push(String(e)));
  await page.route(u => u.pathname === '/a/' + TOKEN, r =>
    r.fulfill({ status: 200, contentType: 'text/html', body: INDEX }));
  await page.goto('/a/' + TOKEN);
  /* The module actually ran. Without this every check below can pass on a dead page —
     the card and its three buttons are static HTML and render either way. */
  await expect.poll(async () =>
    page.evaluate(() => typeof window.__HU_CALLS__ !== 'undefined'),
    { timeout: 5000 }).toBe(true);
  stub.thrown = thrown;
  return stub;
}

async function answersSent(stub) {
  const calls = await stub.calls();
  return calls.filter(c => c.name === 'portalRsvp').map(c => c.payload.response);
}

test.describe('One link opens the three answers', () => {

  test('the short link boots the app and asks the question', async ({ page }) => {
    const stub = await openTextLink(page);

    /* It reached the answer page by the route the reader builds. */
    await expect.poll(async () => page.evaluate(() => location.hash), { timeout: 5000 })
      .toBe('#/payment?token=' + TOKEN + '&rsvp=ask');

    await expect(page.locator('#rsvpAskRow')).toBeVisible();
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/having lights this season/i);
    expect(stub.thrown).toEqual([]);
  });

  /* ⚠ THE THREE WORDS ADDIE ASKED FOR, AND THE EMAIL'S OWN. A customer who gets both
     the email and the text is being asked one question, not two. */
  test('and it says Yes, Back Next Year and No', async ({ page }) => {
    await openTextLink(page);
    await expect(page.locator('#rsvpAskYesBtn')).toHaveText(/^Yes$/);
    await expect(page.locator('#rsvpAskBackBtn')).toHaveText(/^Back Next Year$/);
    await expect(page.locator('#rsvpAskNoBtn')).toHaveText(/^No$/);
  });

  /* ⛔ THE SCANNER CASE, AND THE REASON THIS PAGE IS SAFE TO SEND BY TEXT. A corporate
     mail gateway really did fetch `rsvp=no` and `rsvp=back` for two customers on work
     addresses at 3:42am. This link names no answer at all, so opening it cannot give
     one — and that is asserted here rather than reasoned about. */
  test('opening it answers nothing', async ({ page }) => {
    const stub = await openTextLink(page);
    /* ⚠ THE WAIT IS THE CHECK. Asserting "no call yet" the instant the page loads
       passes even on code that sent on load and had not come back — the vacuous shape
       this repo keeps re-learning. Give it a second of real time. */
    await page.waitForTimeout(1000);
    expect(await answersSent(stub)).toEqual([]);
  });

  /* ⭐ AND ONE TAP IS THE WHOLE ANSWER — no second "are you sure?". The customer has
     just tapped a button we drew, which is the human action rsvpAwaitConfirmTap exists
     to require; asking again on the same screen loses answers for no protection. */
  for (const [label, id, sent] of [
    ['Yes', '#rsvpAskYesBtn', 'yes'],
    ['No', '#rsvpAskNoBtn', 'no'],
    ['Back Next Year', '#rsvpAskBackBtn', 'backnextyear']
  ]) {
    test(`${label} records ${sent} on one tap`, async ({ page }) => {
      const stub = await openTextLink(page);
      await page.locator(id).click();
      await expect.poll(async () => (await answersSent(stub)).slice(-1)[0], { timeout: 5000 })
        .toBe(sent);
      /* ⚠ AND NO CONFIRM ROW APPEARS AFTERWARDS. If the second tap came back, this page
         would sit waiting on a button the customer has no reason to expect. */
      await expect(page.locator('#rsvpTapRow')).toBeHidden();
    });
  }

  /* ⚠ THE CLASS BUG THIS REPO ALREADY SHIPPED ONCE: every handler correct, and the
     customer looking at the new-customer install-details form. */
  test('and never shows the new-customer form', async ({ page }) => {
    await openTextLink(page);
    await expect(page.locator('#page-quote-details')).toBeHidden();
    await page.locator('#rsvpAskYesBtn').click();
    await expect(page.locator('#page-quote-details')).toBeHidden();
  });

  /* ⚠ BACK NEXT YEAR'S CONFIRMATION IS ON A DIFFERENT PAGE — #backNextYearConfirm
     inside #page-home, which only the rsvp-back class opens. Without the class the
     answer records while the customer watches an unchanged card, which looks exactly
     like the button doing nothing. */
  test('Back Next Year moves them to its own confirmation', async ({ page }) => {
    const stub = await openTextLink(page);
    await page.locator('#rsvpAskBackBtn').click();
    await expect(page.locator('#backNextYearConfirm')).toBeVisible();
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();
    await expect.poll(async () => (await answersSent(stub)).slice(-1)[0], { timeout: 5000 })
      .toBe('backnextyear');
  });

  /* ⭐ THE REFERRAL OFFER ([[REF-43]]). The text cannot carry the link — a second
     address takes the message past one 160-character segment — so the offer lives on
     the page. Back Next Year is the only answer that never loads the portal, so it is
     the only screen that has to carry it; a yes and a no are handed to the portal,
     where Refer a Friend is a tab.
     ⚠ THIS IS A BROWSER SPEC BECAUSE THE CLAIM IS A BOX ON A SCREEN carrying a real
     address, drawn only after the answer came back. A regex over index.html cannot see
     any of that, and this repo has shipped a message that was in the source and could
     never reach the page at least three times. */
  test('Back Next Year is shown their own referral link', async ({ page }) => {
    await openTextLink(page);
    await page.locator('#rsvpAskBackBtn').click();
    await expect(page.locator('#backReferBlock')).toBeVisible();
    await expect(page.locator('#backReferLink'))
      .toHaveValue(new RegExp('/r/' + CUSTOMERS.standard.record.referralToken + '$'));
    /* ⚠ AND IT PROMISES THE RIGHT SEASON. [[REF-23]]: somebody sitting this one out has
       no bill for the $25 to come off, so it is next season's. */
    await expect(page.locator('#backReferBlock')).toContainText(/next season/i);
  });

  /* ⛔ THE "YES DOES NOT DRAW IT" CHECK IS DELIBERATELY NOT HERE, and that is worth
     writing down rather than leaving as a gap. It was written, it passed, and the
     red-check proved it COULD NOT FAIL: #backReferBlock lives in #page-home, which
     `rsvp-minimal` without `rsvp-back` hides with !important — so on a yes it is hidden
     because its whole PAGE is, not because anything decided not to draw it. Making the
     stub hand a token to every answer left all eleven tests green.
     ⭐ SO THAT CLAIM IS HELD WHERE IT CAN BITE: rsvp-text-link.test.js asserts
     showBackReferral is called from handleBackNextYear and from nowhere else, and that
     the server mints a token for that answer alone. A check that cannot fail is worse
     than no check, because it reads as coverage. */

  /* ⚠ AN IMPATIENT DOUBLE TAP MUST NOT SEND TWO DIFFERENT ANSWERS. On a phone the
     second tap lands on whatever is under the finger, which is a different button —
     and the last answer written is the one that decides whether a crew is sent. */
  test('a second tap after answering sends nothing more', async ({ page }) => {
    const stub = await openTextLink(page);
    await page.locator('#rsvpAskYesBtn').click();
    await expect.poll(async () => (await answersSent(stub)).length, { timeout: 5000 }).toBe(1);

    /* The row goes first, so a real finger cannot reach a second button at all. */
    await expect(page.locator('#rsvpAskRow')).toBeHidden();

    /* ⚠ AND THE HANDLERS ARE DROPPED TOO, WHICH IS THE HALF THAT MATTERS. Hiding the
       row alone would leave three live onclicks on nodes still in the document, and
       this repo's own history is full of controls that were invisible and still armed.
       A .click() called in the page fires on a hidden element, so this reaches the
       handler if one is still there — which a Playwright click cannot do, and which is
       why the first draft of this test failed on correct code. */
    await page.evaluate(() => {
      document.getElementById('rsvpAskNoBtn').click();
      document.getElementById('rsvpAskBackBtn').click();
    });
    await page.waitForTimeout(500);
    expect(await answersSent(stub)).toEqual(['yes']);
  });
});
