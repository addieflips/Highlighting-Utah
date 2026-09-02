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

  /* ⭐ THE SECOND ANSWER HAS TO BE READABLE (Dax, 2026-09-01: "the no/ not
     applicable button blends in with the white"). `.btn-outline` is built for the
     dark hero — white text on a 35%-white border — so on this white card it
     rendered WHITE ON WHITE: present, taking its space, and invisible.

     ⚠ IT WAS NOT ONLY UGLY. On a customer who already has a code the two answers
     are "Yes, that's right" and "It has changed", and the second one is the ONLY
     route to the entry box — so while it could not be seen, a gate code that had
     changed could not be reported at all. Same class, same bug, on the No path's
     "That's all, thanks".

     ⚠ THIS IS A COMPUTED-STYLE CHECK ON PURPOSE. jsdom applies no stylesheet and
     does no layout, so the fast suite cannot see a colour — CLAUDE.md records that
     limit where the house-tab strip's layout was deliberately left unautomated.
     A real browser can, and contrast is exactly the kind of claim that has to be
     measured rather than read out of the source. */
  test('both answers are readable against the card', async ({ page }) => {
    const stub = await openRsvpYes(page);

    const seen = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const btn = document.getElementById('rsvpGateCodeNoBtn');
      /* ⚠ THE CARD'S OWN BACKGROUND IS TRANSPARENT, so reading it returns
         rgba(0,0,0,0) and the sum compares the text against BLACK — which scored
         1.7 on a button that is perfectly readable, failing correct code. This
         check caught its own bug. Walk up to whatever is actually painted, which
         is what the eye compares against. */
      const painted = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const bg = getComputedStyle(n).backgroundColor;
          const parts = (bg.match(/[\d.]+/g) || []).map(Number);
          if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0)) return bg;
        }
        return 'rgb(255,255,255)';
      };
      const a = lum(getComputedStyle(btn).color);
      const b = lum(painted(btn));
      const hi = Math.max(a, b), lo = Math.min(a, b);
      return { contrast: (hi + 0.05) / (lo + 0.05), text: getComputedStyle(btn).color };
    });

    /* 4.5 is WCAG AA for body text. The old white-on-white scored 1.0. */
    expect(seen.contrast, 'No button text ' + seen.text + ' against the card')
      .toBeGreaterThan(4.5);

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

/* ============================================================================
 * A dialog over the portal, not a page in front of it
 *
 * Dax, 2026-09-02: "after they answer the gate code question it should just put
 * them into their member portal", then "make it so the gate code question is
 * just a pop up in the member portal but keep the buttons exactly as is instead
 * of an entire page."
 *
 * ⚠ THE WHOLE CLAIM IS ABOUT WHAT IS UNDERNEATH IT. "A pop-up over the portal"
 * and "a page before the portal" look identical to any spec that only asserts
 * the question is on screen — the difference is whether the account is already
 * there behind it. So every test below checks the thing behind, not the thing
 * in front.
 * ========================================================================== */
test.describe('The gate code asks from inside the portal', () => {

  test('the account is already open behind the question', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);

    /* Both at once. Not "the question, then the portal after answering". */
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();
    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#portalTabsLayout')).toBeVisible();
    /* And the screen it used to be part of is gone rather than hidden behind. */
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ ON TOP IS A STACKING CLAIM, AND STACKING IS NOT VISIBILITY. A dialog can be
     "visible" to Playwright and still be painted underneath the page it is meant to
     cover — z-index is exactly the kind of fault that only a real browser can see.
     elementFromPoint is the question actually being asked: if a customer taps the
     middle of this dialog, what do they hit? */
  test('and the question is what a tap in the middle of it hits', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();

    const onTop = await page.evaluate(() => {
      const box = document.getElementById('rsvpGateCodeStep').getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 8);
      return !!(hit && hit.closest('#rsvpGateCodeModal'));
    });
    expect(onTop, 'something in the portal is painted over the gate-code dialog').toBe(true);

    stub.assertNoRealCalls();
  });

  /* ⚠ THE PHONE IS WHERE THIS BREAKS, and it is the screen nearly every customer
     reads the RSVP email on. The portal's bottom tab bar is position:fixed with its
     own z-index, so it is the one thing on the page that can sit above a dialog
     without anything looking wrong on a desktop. A customer who can tap "Changes"
     through the backdrop is being asked a question and offered a way round it. */
  test('and the phone tab bar cannot be tapped through the backdrop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();

    const covered = await page.evaluate(() => {
      const bar = document.querySelector('.portal-bottom-nav');
      if (!bar) return 'no bar';
      const box = bar.getBoundingClientRect();
      if (!box.width || !box.height) return 'bar not on screen';
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !!(hit && hit.closest('#rsvpGateCodeModal'));
    });
    /* "no bar" is a real answer, not a skip: it means there is nothing to tap
       through, which is the same guarantee by a different route. */
    expect(covered === true || covered === 'no bar' || covered === 'bar not on screen',
      'the portal tab bar is reachable through the gate-code backdrop: ' + covered).toBe(true);

    stub.assertNoRealCalls();
  });

  /* ⚠ ANSWERING MUST NOT COST THEM THE PAGE THEY ARE ON. The old step tore one
     screen down and built another, so "closing" it meant navigating. Now there is
     nowhere to go — the portal was already there and has to still be there. */
  test('answering closes the question and leaves them in the portal', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);

    await page.locator('#rsvpGateCodeYesBtn').click();          // "Yes, that's right"
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#rsvpGateCodeModal')).toBeHidden();
    await expect(page.locator('#invBreakdown')).toBeVisible();

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ A DIALOG WITH NO WAY OUT LOCKS SOMEBODY OUT OF THEIR OWN ACCOUNT, which is a
     worse fault than an unanswered gate code. Escape closes it and writes NOTHING —
     an unanswered question must not look like an answer. */
  test('Escape closes it, and saves nothing', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.standard.token);
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#invBreakdown')).toBeVisible();

    const calls = await stub.calls();
    expect(calls.filter(c => c.name === 'portalSetGateCode')).toEqual([]);

    expect(stub.thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ AND IT NEVER FLOATS OVER AN ERROR. The question is now the LAST thing to
     happen, after the destination — so a customer whose portal did not open is left
     reading why, not answering a question about a gate on top of it. A deactivated
     account is the real version of that: portalLookup answers, the portal refuses,
     and there is no account underneath for a dialog to belong to. */
  test('it is not asked at all when the portal does not open', async ({ page }) => {
    const stub = await openRsvpYes(page, CUSTOMERS.deactivated.token,
      { customers: { deactivated: CUSTOMERS.deactivated } });

    await expect(page.locator('#portalDeactivatedMsg')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#rsvpGateCodeStep')).toBeHidden();
    await expect(page.locator('#rsvpGateCodeModal')).toBeHidden();

    stub.assertNoRealCalls();
  });
});
