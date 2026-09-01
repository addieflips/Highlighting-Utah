/*
 * RSVP email links — browser specs
 *
 * ⭐ WHY THESE ARE BROWSER SPECS AND NOT SOURCE CHECKS. Every claim here is
 * about WHAT IS ON THE SCREEN after a customer presses a button in an email.
 * The bug these were written against was one wrong class name in the router:
 * every message, every handler and every button was present and correct in the
 * source, and a customer pressing Approve still landed on the new-customer
 * install-details form. A regex over index.html passes on that code. Running
 * it does not. (CLAUDE.md §5, "a message that is in the source is not a
 * message on the screen".)
 *
 * THE THREE LINKS, read out of admin.html's template renderer rather than
 * guessed — {{rsvp_yes_button}} / {{rsvp_no_button}} / {{rsvp_back_button}}:
 *     Yes            #/payment?token=XXXX&rsvp=yes
 *     No             #/payment?token=XXXX&rsvp=no
 *     Back Next Year #/?token=XXXX&rsvp=back
 * The first two are answered by handleRsvpLink, the third by
 * handleBackNextYear. Change a URL in admin.html and change it here.
 *
 * Each spec asserts THREE things, because the bug satisfied the first one on
 * its own: the answer that reached the server, the confirmation the customer
 * reads, and — the half that was broken — that the quote-details FORM is not
 * what they are looking at.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS } = require('./fixtures');

async function open(page, path) {
  const stub = await installFirebaseStub(page);

  /* ⚠ THROWN JS AND CONSOLE NOISE ARE KEPT APART, DELIBERATELY. A script that
     THREW is a product failure and is asserted empty below. A console line is
     not: the stub aborts every real backend URL by design (§9.4), and a font
     or an image that will not load in a sandbox reports the same way — so
     asserting on those makes the spec fail for reasons that have nothing to do
     with the page. They are still collected, and printed when something else
     fails, because that is when they are worth reading. */
  const thrown = [];
  const consoleNoise = [];
  page.on('pageerror', e => thrown.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleNoise.push(m.text()); });
  await page.goto(path);
  stub.thrown = thrown;
  stub.consoleNoise = consoleNoise;
  return stub;
}

/* The one assertion the old code failed. #page-quote-details is where a NEW
 * customer fills in colours, wire and timer — an existing member answering an
 * RSVP has all of it on file already and must never be shown it. */
async function expectNotTheQuoteForm(page) {
  await expect(page.locator('#page-quote-details')).toBeHidden();
  await expect(page.locator('#quoteDetailForm')).toBeHidden();
}

test.describe('RSVP email links', () => {

  test('Yes — confirms them for the season and offers the portal, not the form', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}&rsvp=yes`);

    /* 1. What reached the server. */
    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('yes');

    /* 2. What they read. */
    await expect(page.locator('#rsvpConfirmCard')).toBeVisible();
    /* ⚠ THE GATE-CODE STEP NOW COMES FIRST on a yes (Addie, 2026-08-31: "Lets
       do gate code before changes"), so this clicks through it to reach the
       confirmation it has always been about. That is following the flow, not
       relaxing the check — every assertion below is unchanged, and the step
       itself is proved in test/rsvp-gate-code.spec.js. */
    await page.locator('#rsvpGateCodeYesBtn').click();
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/confirmed for this season/i);
    await expect(page.locator('#rsvpOpenPortalBtn')).toBeVisible();
    await expect(page.locator('#rsvpNoChangesBtn')).toBeVisible();

    /* 3. What they must NOT be looking at. */
    await expectNotTheQuoteForm(page);

    /* Minimal mode: a receipt, not the website. Nothing to browse away into. */
    await expect(page.locator('header')).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⭐ CHANGED 2026-09-01 (RS-31). Addie: "can no go straight to member portal but
     will track it even if they don't get to member portal." This used to assert the
     interstitial — "sorry to miss you" plus a Tell us why button — which was her
     2026-08-19 ruling and is now superseded. The check that MATTERS is unchanged and
     is asserted first: the answer reaches the server BEFORE any navigation, so it is
     recorded whether or not they ever arrive in the portal. */
  test('No — records the no first, then takes them into the portal', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/payment?token=${cust.token}&rsvp=no`);

    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('no');

    /* ⚠ THE ORDER IS THE GUARANTEE, so it is asserted as an order and not merely as
       "both happened": portalRsvp must be the FIRST call, ahead of everything the
       portal itself fetches. Reversed, a customer who closes the tab while the
       account is loading has said no and we never heard it. */
    const names = (await stub.calls()).map(c => c.name);
    expect(names[0], 'the answer must reach the server before the portal is opened')
      .toBe('portalRsvp');

    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    await expectNotTheQuoteForm(page);

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('Back Next Year — its own status and its own confirmation on the home page', async ({ page }) => {
    const cust = CUSTOMERS.standard;
    const stub = await open(page, `/index.html#/?token=${cust.token}&rsvp=back`);

    /* ⚠ 'backnextyear', NOT 'no'. They are two different answers: a no queues
       the lights for recycling, Back Next Year deliberately does not. */
    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('backnextyear');

    await expect(page.locator('#backNextYearConfirm')).toBeVisible();
    await expect(page.locator('#backNextYearConfirmMsg')).toContainText(/next year/i);

    await expectNotTheQuoteForm(page);
    await expect(page.locator('header')).toBeHidden();

    /* The rest of the home page is off — otherwise the confirmation is a line
       floating above the marketing site they did not ask to visit. */
    await expect(page.locator('#page-home .page-hero').first()).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

});

/* ---- A LINK THAT NO LONGER MATCHES AN ACCOUNT ---------------------------
 *
 * ⚠ THE MESSAGE WAS THE SIGN-IN FORM'S, SHOWN TO SOMEBODY WHO NEVER SIGNED IN.
 * Both Yes and No failed into `#lookupEmpty` — "We couldn't find an account
 * matching that phone number and last name" — at a customer who typed neither
 * and only pressed a button in an email. It reads exactly like the button
 * being broken, which is what it was reported as.
 *
 * ⚠ AND IT WAS THE ONLY PATH THEY HAD. portalRsvp reports a miss by THROWING
 * (`HttpsError('not-found')`), which REJECTS the callable — so the `!res.ok`
 * branch is unreachable in production and EVERY failure landed there.
 *
 * ⚠ handleBackNextYear ALREADY used the friendly shared wording. This is the
 * same "one reader left behind when the others were changed" shape as the
 * quote link on 2026-08-31, which is where `portalCallFailedText` came from.
 */
test.describe('An RSVP link that no longer matches an account', () => {

  test('Yes says the link may be out of date, not that a sign-in failed', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=nosuchtoken&rsvp=yes');

    const card = page.locator('#rsvpConfirmCard');
    await expect(card).toBeVisible();
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/link may be out of date/i);
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/901-0011/);

    /* ⚠ THE WRONG MESSAGE MUST BE GONE, not merely covered up. A customer who
       never typed a phone number or a last name cannot act on being told those
       did not match. */
    await expect(page.locator('#lookupEmpty')).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  test('No gets the same treatment', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=nosuchtoken&rsvp=no');

    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/link may be out of date/i);
    await expect(page.locator('#lookupEmpty')).toBeHidden();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ A GENUINE OUTAGE MUST STILL READ AS ONE. Calling every failure a stale
     link is the opposite error, and it hides a real fault behind a reassuring
     sentence — the exact caveat written into portalCallFailedText. */
  test('a real server failure still reads as a failure, not a stale link', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=forceinternal&rsvp=yes');

    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/something went wrong/i);
    await expect(page.locator('#rsvpConfirmMsg')).not.toContainText(/out of date/i);

    stub.assertNoRealCalls();
  });

});

/* ---- ONE ANSWER, ONE CARD ------------------------------------------------
 *
 * Addie, 2026-09-01, over a screenshot of a bare "One moment…":
 *   "this is what happens when I open up Yes or No, but back next year seems
 *    to be working"
 *
 * ⭐ THE SENTENCE WAS THE DIAGNOSIS. The three answers land on TWO different
 * cards in TWO different pages — yes/no on #rsvpConfirmCard inside
 * #page-payment, back next year on #backNextYearConfirm inside #page-home —
 * and body.rsvp-minimal force-showed BOTH pages for every route. So a yes or a
 * no opened with the back-next-year card above it, still holding the static
 * "One moment…" that only handleBackNextYear ever rewrites. The real
 * confirmation rendered correctly, below the fold, under a dead card.
 *
 * ⚠ IT LOOKED LIKE A HANG AND WAS NOT. The answer was recorded, the message was
 * built — which is exactly why every existing check passed. The specs above
 * assert what the RIGHT card says; not one of them noticed a SECOND card on the
 * same screen. That is the gap these close, and it is the same shape as the bug
 * this class was introduced to fix in the first place.
 *
 * ⚠ AND BACK NEXT YEAR WAS LEAKING TOO — it left #page-payment open underneath,
 * so the SIGN-IN FORM sat below the goodbye. "Seems to be working" was the
 * correct message happening to be on top of the wrong page.
 */
test.describe('One answer shows one card, and nothing else', () => {

  const TOKEN = CUSTOMERS.standard.token;

  test('Yes does not show the Back Next Year card', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${TOKEN}&rsvp=yes`);

    await expect(page.locator('#rsvpConfirmCard')).toBeVisible();
    await expect(page.locator('#backNextYearConfirm')).toBeHidden();
    /* The sign-in form lives on the same page as the yes/no card, and an RSVP
       answer must never sit above a box asking them to sign in. */
    await expect(page.locator('#lookupFormWrap')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ NO LEAVES THIS SCREEN ALTOGETHER NOW (RS-31) — it goes straight into the
     portal — so what must be true is that the Back Next Year card never appears on
     the way past, which is the fault this describes. */
  test('No does not flash the Back Next Year card on its way to the portal', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${TOKEN}&rsvp=no`);

    await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#backNextYearConfirm')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ THE STATIC TEXT IS THE TELL, and it is asserted by its own words rather
     than by the element being hidden: "One moment…" is what the markup ships
     and what a customer stares at for ever when the wrong card is revealed. */
  test('and neither one leaves a stray "One moment" on screen', async ({ page }) => {
    for (const answer of ['yes', 'no']) {
      const stub = await open(page, `/index.html#/payment?token=${TOKEN}&rsvp=${answer}`);
      /* Yes settles on this card; No carries on into the portal (RS-31). Either way
         the assertion below is the same one, and it is the point of this test. */
      await expect(answer === 'yes'
        ? page.locator('#rsvpConfirmCard')
        : page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
      /* ⚠ VISIBLE ONLY, and that is not a loosening. Both cards legitimately KEEP
         that text in the DOM — it is the markup default each handler overwrites —
         so counting DOM matches asserts something that was never true and fails on
         correct code. What must be true is that none of them is on screen. */
      await expect(page.locator(':text("One moment"):visible')).toHaveCount(0);
      stub.assertNoRealCalls();
    }
  });

  /* ⚠ THE MIRROR, and it is not symmetry for its own sake: the back route was
     leaking the payment page, so this is a real fix and not a guard. */
  test('Back Next Year shows only its own card, with no sign-in form under it', async ({ page }) => {
    const stub = await open(page, `/index.html#/?token=${TOKEN}&rsvp=back`);

    await expect(page.locator('#backNextYearConfirm')).toBeVisible();
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();
    await expect(page.locator('#lookupFormWrap')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });
});
