/*
 * A button nobody can see is a button that does not exist
 *
 * Addie, 2026-09-01, on the RSVP yes: "on computer the do you have gate code
 * comes up far left and it doesn't give you an option you can only choose yes
 * I have one".
 *
 * ⭐ SHE COULD ONLY SEE ONE OPTION BECAUSE THE OTHER WAS WHITE ON WHITE.
 * `.btn-outline` is `color:#fff` with a translucent white border — built for the
 * dark green hero at the top of the site. On the white cards the RSVP and portal
 * screens are made of, it renders as nothing at all: measured on the real page,
 * `color: rgb(255,255,255)` against a `rgb(255,255,255)` background. The button
 * was present, sized, laid out and clickable, and completely invisible.
 *
 * ⚠ IT WAS NEVER ONE BUTTON. The same class sat on "No, I'm All Set" on the very
 * next question, on the two colour-pattern "Clear" buttons, and — worst — on
 * PAY WITH VENMO inside the payment dropdown, so the fallback payment method
 * Addie asked to keep as a last resort could not be seen at all.
 *
 * ⚠ AND NO EXISTING CHECK COULD HAVE CAUGHT IT. Every spec in this suite asks
 * whether an element is VISIBLE, and Playwright's answer is about layout — a
 * white-on-white button is `visible: true`, has a bounding box, and passes a
 * click. Colour is the one thing none of them looked at.
 *
 * `.btn-outline-dark` already existed for exactly this and is what these use now.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, INVOICES } = require('./fixtures');

const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;

/* The effective background BEHIND an element: the nearest ancestor that actually
   paints one. A button with a transparent background sits on whatever that is,
   which is the comparison that matters and the one `toBeVisible` never makes. */
async function readability(page, id) {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    /* ⚠ A NEARLY-TRANSPARENT BACKGROUND IS NOT A BACKGROUND, and the red-check is
       what taught this: .btn-outline:hover paints rgba(255,255,255,0.1), so with the
       pointer resting on it the sabotaged button had an "own" colour a shade off pure
       white and the check passed on a button that was still invisible. Only a
       essentially-opaque fill counts as something you can read text against. */
    const paints = (c) => {
      if (!c || c === 'transparent') return false;
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return true;
      const parts = m[1].split(',').map(x => parseFloat(x.trim()));
      const alpha = parts.length > 3 ? parts[3] : 1;
      return alpha >= 0.9;
    };
    let behind = 'none', n = el.parentElement;
    while (n && n !== document.documentElement) {
      const b = getComputedStyle(n).backgroundColor;
      if (paints(b)) { behind = b; break; }
      n = n.parentElement;
    }
    const own = paints(cs.backgroundColor) ? cs.backgroundColor : behind;
    return { missing: false, color: cs.color, own: own, behind: behind, border: cs.borderColor };
  }, id);
}

/* ⚠ THE ASSERTION IS "the text is not the same colour as what it sits on", NOT a
   full contrast-ratio calculation. A ratio needs luminance maths this suite has no
   business owning, and the fault here is the degenerate case that maths exists to
   catch. Keeping it exact also keeps it unarguable: identical is always wrong. */
async function expectReadable(page, id) {
  /* Park the pointer in the corner first: a :hover rule must never be what makes a
     button look readable, and Playwright leaves the mouse wherever it last clicked. */
  await page.mouse.move(0, 0);
  const r = await readability(page, id);
  expect(r.missing, id + ' is not on the page at all').toBe(false);
  expect(r.color, id + ' has text the same colour as its own background — invisible')
    .not.toBe(r.own);
}

test.describe('Buttons on the light cards can actually be seen', () => {

  test('the gate-code question offers TWO visible answers', async ({ page }) => {
    /* ⚠ THE FIXTURE KEEPS ITS GATE CODE NOW (2026-09-02, RS-44). This used to clear it
       to reach the "do you have one?" wording — the branch Addie was in when the
       white-on-white button was reported. That branch is gone: only a customer who
       ALREADY has a code is asked. The fault this test exists for is unchanged and if
       anything sharper, because on this path the second answer, "It has changed", is
       the only route to the entry box. */
    const c = JSON.parse(JSON.stringify(CUSTOMERS.standard));
    const stub = await installFirebaseStub(page, { customers: { standard: c } });
    await page.goto(`/index.html#/payment?token=${c.token}&rsvp=yes`);

    await expect(page.locator('#rsvpGateCodeYesBtn')).toBeVisible();
    await expect(page.locator('#rsvpGateCodeNoBtn')).toBeVisible();
    await expectReadable(page, 'rsvpGateCodeYesBtn');
    await expectReadable(page, 'rsvpGateCodeNoBtn');

    stub.assertNoRealCalls();
  });

  /* ⚠ RETIRED 2026-09-01, AND THE COVERAGE LOSS IS STATED RATHER THAN PAPERED OVER.
     This drove "do you want to make any changes?" and checked its two buttons were
     legible. That screen no longer exists: RS-31 sends a yes straight into the portal
     after the gate-code step, so there is nothing between them and their account.

     #rsvpOpenPortalBtn and #rsvpNoChangesBtn still EXIST — they are what the No path
     falls back to when the portal cannot be opened — and they now carry
     btn-outline-dark, so the fault this file is about cannot reach them. But that
     fall-back needs loadPortalByToken to be absent or to throw, which is module-scope
     and cannot be reached from a spec, so nothing here proves their colour. Two
     things do still guard it: the card-scoped override main added in #278
     (#rsvpConfirmCard .btn-outline), and the gate-code check above, which sits on the
     same card with the same rule. If that fall-back ever becomes reachable, test it
     here rather than trusting this paragraph. */

  /* ⚠ THE ONE WITH MONEY ON IT. Venmo was deliberately demoted behind a dropdown
     (MON-40, "a last resort"), and a last resort that cannot be seen when it is
     opened is not a last resort. */
  test('Pay with Venmo is legible once the dropdown is opened', async ({ page }) => {
    const stub = await installFirebaseStub(page, {});
    await page.goto(`/index.html#/payment?token=${CUSTOMERS.standard.token}`);
    await expect(page.locator('#otherPaymentsPanel')).toBeVisible({ timeout: 8000 });
    await page.locator('#otherPaymentsPanel summary').click();

    await expect(page.locator('#venmoPayBtn')).toBeVisible();
    await expectReadable(page, 'venmoPayBtn');

    stub.assertNoRealCalls();
  });
});

test.describe('The RSVP card is centred, not shoved to one side', () => {

  /* ⚠ MEASURED, NOT EYEBALLED. rsvp-minimal makes #page-payment a flex container,
     and its only visible child had no width — so it shrank to its content and
     settled at flex-start. At 1440px the card sat at x=65, w=584.

     ⚠ REACHED THROUGH A FAILED RSVP, and that is the only way left rather than a
     contrived one. Both answers now leave this card within a moment — a yes lands in
     the portal with the gate question over it (2026-09-02), a no carries straight
     through (RS-33) — so the one state a customer is genuinely LEFT sitting on it is
     an RSVP that could not be recorded. `forceinternal` is the stub's documented
     sentinel for exactly that. The layout being measured is identical: rsvpLinkFailed
     reveals this same card with `rsvp-minimal` still on the body, which is the
     condition the bug needed. */
  test('on a desktop width the card sits in the middle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stub = await installFirebaseStub(page, {});
    const thrown = [];
    page.on('pageerror', e => thrown.push(String(e)));
    /* ⚠ ONE EXPECTED LINE IS ALLOWED THROUGH, and only one. This route is a
       deliberately failed RSVP, and the page is required to say so out loud —
       "nothing should fail quietly" (Addie, 2026-08-25) — so a console error is the
       correct behaviour here rather than noise to be silenced. Anything else, and
       every pageerror, still fails this test. */
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !BLOCKED_RESOURCE.test(t) && !/portal call failed/.test(t)) thrown.push(t);
    });
    await page.goto('/index.html#/payment?token=forceinternal&rsvp=yes');
    await expect(page.locator('#rsvpConfirmCard')).toBeVisible();

    const box = await page.locator('#rsvpConfirmCard').boundingBox();
    const leftGap = box.x;
    const rightGap = 1440 - (box.x + box.width);
    /* Symmetric to within a few pixels. The broken version was 65 against 791. */
    expect(Math.abs(leftGap - rightGap), `card is off-centre: ${Math.round(leftGap)}px left, ${Math.round(rightGap)}px right`)
      .toBeLessThan(12);

    expect(thrown).toEqual([]);
    stub.assertNoRealCalls();
  });

  /* ⚠ THE SAME COMPLAINT, ABOUT THE THING THAT INHERITED IT. Dax, 2026-09-01:
     "the whole thing is not centered and pretty". The question he was looking at
     when he said that has since become a dialog over the portal, so the centring
     guarantee has to follow it there or it quietly stops being guarded at all. */
  test('and so does the gate-code dialog, over the portal', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stub = await installFirebaseStub(page, {});
    await page.goto(`/index.html#/payment?token=${CUSTOMERS.standard.token}&rsvp=yes`);
    await expect(page.locator('#rsvpGateCodeStep')).toBeVisible();

    const box = await page.locator('#rsvpGateCodeStep').boundingBox();
    const leftGap = box.x;
    const rightGap = 1440 - (box.x + box.width);
    expect(Math.abs(leftGap - rightGap), `dialog is off-centre: ${Math.round(leftGap)}px left, ${Math.round(rightGap)}px right`)
      .toBeLessThan(12);

    stub.assertNoRealCalls();
  });
});
