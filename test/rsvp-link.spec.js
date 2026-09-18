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
const { installFirebaseStub, tapRsvpConfirm } = require('./firebase-stub');
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
  /* ⭐ An RSVP link no longer answers on open — one tap confirms it. No-ops on any
     other link. See tapRsvpConfirm. */
  await tapRsvpConfirm(page, path);
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

/* ===========================================================================
 * OPENING A LINK IS NOT ANSWERING IT (2026-09-11)
 *
 * Addie: "lets do a confirming step."
 *
 * ⚠ THE LINK USED TO BE THE ANSWER. handleRsvpLink called portalRsvp before it drew
 * anything, so whatever FETCHED the URL is what answered — and a corporate mail
 * gateway opens every link in an incoming message to check it is safe, which on an
 * RSVP email means opening all three.
 *
 * ⚠ IT ALREADY HAPPENED. Eric Kling (#474, a work address) had `rsvp=no` fetched at
 * 3:42am and `rsvp=back` at 4:07am from `X11; Linux x86_64 … Chrome/124`. Both failed
 * for an unrelated reason, which is the only thing that saved him: a landed `no` moves
 * a confirmed customer to Maybe Next Year, and nothing records who submitted an RSVP.
 *
 * ⚠ THESE RUN THE REAL PAGE, because the claim is that a call does NOT happen — the
 * one thing a text check over index.html cannot see at all.
 * ========================================================================= */
test.describe('An RSVP link does not answer until it is tapped', () => {

  /* ⚠ NOT `open()` — that helper taps, which is exactly what must not happen here. */
  async function openWithoutTapping(page, path) {
    const stub = await installFirebaseStub(page);
    await page.goto(path);
    return stub;
  }

  for (const [answer, path] of [
    ['yes',  `#/payment?token=${CUSTOMERS.standard.token}&rsvp=yes`],
    ['no',   `#/payment?token=${CUSTOMERS.standard.token}&rsvp=no`],
    ['back', `#/?token=${CUSTOMERS.standard.token}&rsvp=back`]
  ]) {
    test(`${answer} — opening it sends nothing`, async ({ page }) => {
      const stub = await openWithoutTapping(page, '/index.html' + path);
      const row = answer === 'back' ? '#backTapRow' : '#rsvpTapRow';
      await expect(page.locator(row)).toBeVisible();

      /* ⚠ THE WAIT IS THE CHECK. Asserting "no call yet" the instant the page loads
         passes even on the old code, which sent on load but had not come back — the
         vacuous shape this repo keeps re-learning. Give it a second of real time. */
      await page.waitForTimeout(1000);
      const calls = await stub.calls();
      expect(calls.filter(c => c.name === 'portalRsvp')).toHaveLength(0);
    });
  }

  test('and the tap is what sends it', async ({ page }) => {
    const stub = await openWithoutTapping(page,
      `/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=no`);
    await page.locator('#rsvpTapConfirmBtn').click();
    await expect.poll(async () => {
      const calls = await stub.calls();
      const rsvp = calls.filter(c => c.name === 'portalRsvp');
      return rsvp.length ? rsvp[rsvp.length - 1].payload.response : null;
    }).toBe('no');
  });

  test('the button says which answer it is confirming', async ({ page }) => {
    /* ⚠ A BARE "Confirm" IS THE ONE WORDING THIS MUST NOT HAVE. The customer arrived
       by tapping a coloured button in an email and may not remember which; a button
       that does not name the answer turns a safety step into a coin toss. */
    await openWithoutTapping(page, `/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=no`);
    await expect(page.locator('#rsvpTapConfirmBtn')).toContainText(/not this season/i);
    await openWithoutTapping(page, `/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=yes`);
    await expect(page.locator('#rsvpTapConfirmBtn')).toContainText(/I'm in/i);
    await openWithoutTapping(page, `/index.html#/?token=${CUSTOMERS.standard.token}&rsvp=back`);
    await expect(page.locator('#backTapConfirmBtn')).toContainText(/back next year/i);
  });

  test('a second link in the same tab does not double the answer', async ({ page }) => {
    /* ⭐ WHY rsvpAwaitConfirmTap ASSIGNS onclick RATHER THAN addEventListener. The card
       is reused by all three answers, and both URLs here differ only by their hash — so
       the second one is a hashchange in the SAME document and the gate runs again on the
       same button. With addEventListener the handlers would STACK, and the single tap
       below would send the answer twice.

       ⚠ THE FIRST LINK IS DELIBERATELY NOT TAPPED. Tapping it would send an answer and
       open the gate-code modal, whose backdrop then swallows the second tap — and a
       fresh page between the two would reset the listeners and make this vacuous, which
       is the whole thing it is trying to catch. */
    const stub = await openWithoutTapping(page,
      `/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=yes`);
    await expect(page.locator('#rsvpTapConfirmBtn')).toContainText(/I'm in/i);

    await page.goto(`/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=no`);
    await expect(page.locator('#rsvpTapConfirmBtn')).toContainText(/not this season/i);

    await page.locator('#rsvpTapConfirmBtn').click();
    await expect.poll(async () =>
      (await stub.calls()).filter(c => c.name === 'portalRsvp').length).toBe(1);

    /* Give a stacked second handler time to fire before declaring there was only one. */
    await page.waitForTimeout(800);
    const sent = (await stub.calls()).filter(c => c.name === 'portalRsvp');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.response).toBe('no');
  });
});

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

    /* 2. What they read. Dax, 2026-09-02: the gate code is "just a pop up in the
       member portal ... instead of an entire page", so the portal is what a yes
       lands on and the question arrives ON TOP of it. Addie's ruling that it is
       asked at all, and asked before anything else, is unchanged — it is simply
       no longer a screen standing in the way of the account.

       ⚠ THE BILL IS ASSERTED FIRST, ON PURPOSE. #invBreakdown proves they are
       actually IN the portal while the question is still open, which is the whole
       claim; asserting it only after the click would leave "pop-up over the portal"
       and "page before the portal" looking identical to this spec. */
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();
    /* ⚠ THE SECOND BUTTON, because this fixture already HOLDS a code — with one on
       file the two answers are "Yes, that's right" and "It has changed", and it is
       the second that opens the box. Clicking Yes here would confirm and close, and
       prove nothing about the save. */
    await page.locator('#rsvpGateCodeNoBtn').click();
    await page.locator('#rsvpGateCodeInput').fill('9182');
    await page.locator('#rsvpGateCodeSaveBtn').click();
    /* Answering closes the question and leaves them where they already were. */
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#invBreakdown')).toBeVisible();

    /* 3. What they must NOT be looking at. */
    await expectNotTheQuoteForm(page);

    /* ⚠ AND MINIMAL MODE IS DELIBERATELY OVER BY NOW. `rsvp-minimal` strips the
       page down to a receipt, which is right while the card is the whole screen
       and wrong once they are inside their account — the old "Take me to my
       portal" button removed the same two classes for the same reason. So the
       header being BACK is the assertion here, not a relaxed one. The no and
       back-next-year paths still end on the receipt and still assert it hidden. */
    await expect(page.locator('header')).toBeVisible();

    expect(stub.thrown, stub.consoleNoise.join('\n')).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⭐ CHANGED 2026-09-01 (RS-33). Addie: "can no go straight to member portal but
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
       "both happened": portalRsvp must land before anything the PORTAL fetches.
       Reversed, a customer who closes the tab while the account is loading has said
       no and we never heard it.

       ⚠ REPOINTED 2026-09-11, NOT WEAKENED. This asserted portalRsvp was call [0] of
       ANY kind, which was true only because the answer used to be sent during
       navigate() — before the page-load `publicConfig` read had come back. The answer
       now waits for a tap (rsvpAwaitConfirmTap), so publicConfig lands first and this
       failed on code that is right. The guarantee has not moved: it is about the
       PORTAL's calls, and it is those that are named. */
    const names = (await stub.calls()).map(c => c.name);
    const saidNoAt = names.indexOf('portalRsvp');
    const portalAt = names.findIndex(n => n === 'portalLookup' || n === 'portalInvoice');
    expect(saidNoAt, 'the no never reached the server at all').toBeGreaterThan(-1);
    expect(portalAt, 'the portal was never opened, so this proves nothing').toBeGreaterThan(-1);
    expect(saidNoAt, 'the answer must reach the server before the portal is opened')
      .toBeLessThan(portalAt);

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
  /* ⚠ REPOINTED 2026-09-11, NOT WEAKENED. It matched "something went wrong", which was
     a flat claim that the answer was lost — and Addie proved it wrong: three customers
     this reported were confirmed on their records. portalRsvp writes the answer before it
     does anything slow, so a timeout or an `internal` means the RESPONSE went missing, not
     the write. The guarantee this check exists for is unchanged and is still asserted: a
     genuine outage must NOT read as a stale link. What changed is the other half. */
  test('a real server failure does not read as a stale link, and does not claim the answer was lost', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=forceinternal&rsvp=yes');

    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/may already be saved/i);
    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/901-0011/);
    await expect(page.locator('#rsvpConfirmMsg')).not.toContainText(/out of date/i);

    stub.assertNoRealCalls();
  });

  /* ⭐ AND A SLOW ANSWER IS NOT A LOST ONE. This is the case from the Errors folder:
     seven members over three days were told their RSVP failed, and the ones Addie checked
     were confirmed on their records all along. */
  test('an answer that times out once is retried, and goes through', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=failoncethenok&rsvp=yes');

    /* The customer never learns anything went wrong — no apology, no phone number. */
    await expect(page.locator('#rsvpConfirmMsg')).not.toContainText(/901-0011/);
    await expect(page.locator('#rsvpConfirmMsg')).not.toContainText(/may already be saved/i);

    /* ⚠ AND IT REALLY WENT TWICE. Without this the check passes on a page that simply
       swallowed the failure and said nothing, which is worse than the apology. */
    const tries = (await stub.calls()).filter(c => c.name === 'portalRsvp');
    expect(tries.length, 'the first attempt was not retried').toBe(2);
    expect(tries[1].payload.response).toBe('yes');

    stub.assertNoRealCalls();
  });

  /* ⚠ A STALE LINK IS STILL REFUSED ON THE FIRST TRY. Retrying it only makes the customer
     wait three times as long for the same sentence, and the not-found path is the one
     failure we CAN be certain about. */
  test('a stale link is not retried', async ({ page }) => {
    const stub = await open(page, '/index.html#/payment?token=nosuchtoken&rsvp=yes');

    await expect(page.locator('#rsvpConfirmMsg')).toContainText(/out of date/i);
    const tries = (await stub.calls()).filter(c => c.name === 'portalRsvp');
    expect(tries.length, 'a link that cannot be found was tried more than once').toBe(1);

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

  /* ⚠ ANCHORED ON THE GATE-CODE QUESTION NOW, not on the confirmation card. A yes
     no longer settles on that card at all (2026-09-02) — it lands in the portal with
     the question over it — so waiting for the card would wait for something that
     never comes and time out on correct code. The fault being guarded is unchanged:
     one answer must not reveal another answer's card. */
  test('Yes does not show the Back Next Year card', async ({ page }) => {
    const stub = await open(page, `/index.html#/payment?token=${TOKEN}&rsvp=yes`);

    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    await expect(page.locator('#backNextYearConfirm')).toBeHidden();
    /* The sign-in form lives on the same page as the yes/no card, and an RSVP
       answer must never sit above a box asking them to sign in. */
    await expect(page.locator('#lookupFormWrap')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ NO LEAVES THIS SCREEN ALTOGETHER NOW (RS-33) — it goes straight into the
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
      /* ⚠ A REAL RELOAD BETWEEN THE TWO, and it is needed now that the answers are
         TAPPED. Both URLs differ only by their hash, so the second goto is a
         hashchange in the SAME document — and the gate-code modal the first answer
         opened is still up, with its backdrop over the page, so the second tap never
         lands. Nothing about that is new; it only became visible once this test had
         to click something. */
      await page.goto('about:blank');
      const stub = await open(page, `/index.html#/payment?token=${TOKEN}&rsvp=${answer}`);
      /* Both answers carry on into the portal now — a yes with the gate-code
         question over it (2026-09-02), a no straight through (RS-33). Waiting on the
         portal for both is the honest wait; the assertion below is the same one
         either way, and it is the point of this test. */
      await expect(page.locator('#portalTabsLayout')).toBeVisible({ timeout: 8000 });
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
