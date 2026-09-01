/*
 * A yes is not a payment — and the RSVP used to say it was
 *
 * RS-24, Addie 2026-08-31: "If they didn't pay last year they should not be
 * scheduled to be hung." That hold sits OUTSIDE the RSVP branch of
 * isOutForSeason precisely so it applies to somebody who answered YES.
 *
 * ⭐ THE HOLE THIS CLOSES. The RSVP confirmation ended on "We'll get you
 * scheduled!" — so the one group guaranteed NOT to be scheduled was the one
 * being promised a crew. Nothing anywhere said otherwise: the office sees them
 * on Schedule › Owes from last year, the customer saw a tick and a thank-you,
 * and the two only meet in December in front of a dark house.
 *
 * ⚠ IT IS NOT MON-34's AUTOMATIC CHASE, and that distinction is the reason
 * this was safe to build without waking her. Nothing is SENT — no email, no
 * text, no note. It is one sentence on a page the customer opened themselves,
 * answering a button they just pressed, and MON-34's own reasoning already
 * rests on them being able to "see and pay it in their portal".
 *
 * ⚠ EVERY CLAIM HERE IS ABOUT WORDS ON A SCREEN, so these RUN the page. The
 * whole fault was a message that rendered perfectly and was wrong, which no
 * source check can see.
 *
 * ⚠ AND NOTHING HERE REACHES functions/index.js — these run against a fake
 * Firebase. The stub derives the figure from the fixture invoice by the same
 * key rule the server uses rather than returning a constant, but a broken
 * server return would still leave these green. That half is arrears-hold.test.js.
 */

const { test, expect } = require('@playwright/test');
const { installFirebaseStub } = require('./firebase-stub');
const { CUSTOMERS, INVOICES } = require('./fixtures');

const BLOCKED_RESOURCE = /Failed to load resource|net::ERR_|ERR_TUNNEL|ERR_CONNECTION/;
const CUST = CUSTOMERS.standard;

/* Their real invoice plus a carried balance, built the way Start New Season
   writes one: a fee-ledger line tagged `arrears` with the year pinned to it.
   Derived from the fixture rather than hand-written so it cannot drift from
   the shape the rest of the suite proves. */
function withArrears(amount, year) {
  const base = JSON.parse(JSON.stringify(INVOICES[CUST.invoiceKey]));
  base.changeFees = (Number(base.changeFees) || 0) + amount;
  base.changeFeeNotes = (base.changeFeeNotes || []).concat([{
    amount: amount, kind: 'arrears', source: 'office', year: String(year),
    reason: 'Unpaid balance carried from the ' + year + ' season'
  }]);
  /* ⚠ THE PAYMENTS ARE CLEARED, AND THAT IS THE WHOLE FIXTURE (2026-09-01). The
     standard invoice already carries a $200 deposit, which exactly cancelled a $200
     carried balance — so this built a customer who had ALREADY PAID last season while
     the test's name said they owed for it. It passed only because the stub computed
     arrearsOutstanding WITHOUT subtracting payments, unlike the real
     arrearsOutstandingServer; the moment the stub was made faithful, both tests using
     it went red on correct code. A carried debt with money already against it is the
     SETTLED case and is tested separately below. */
  base.deposit = 0;
  base.credits = 0;
  return { invoices: { [CUST.invoiceKey]: base } };
}

async function openRsvpYes(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto(`/index.html#/payment?token=${CUST.token}&rsvp=yes`);
  /* Gate code is asked first (Addie's ordering), so every test here confirms
     the code we already hold and lands in the member portal. */
  await page.locator('#rsvpGateCodeYesBtn').click();
  stub.thrown = thrown;
  return stub;
}

test.describe('RSVP yes from somebody who owes for last season', () => {

  /* ⭐ THE ONE THAT MATTERS. Not "does a notice appear" but "is the promise
     gone" — a page could show the debt AND still end on We'll get you
     scheduled, which is the same lie with a footnote. */
  test('is never told we will get them scheduled', async ({ page }) => {
    const stub = await openRsvpYes(page, withArrears(200, 2025));
    const card = page.locator('#invBreakdown');

    await expect(card).toBeVisible();
    await expect(card).not.toContainText(/get you scheduled/i);
    /* ⚠ `can.t`, NOT `can't` — the page writes &rsquo;, so the rendered text
       carries a CURLY apostrophe and a straight one matches nothing. */
    await expect(card).toContainText(/can.t book your install/i);

    stub.assertNoRealCalls();
  });

  test('is told how much, and which season it is from', async ({ page }) => {
    const stub = await openRsvpYes(page, withArrears(200, 2025));
    const card = page.locator('#invBreakdown');

    await expect(card).toContainText('$200.00');
    await expect(card).toContainText('2025');

    stub.assertNoRealCalls();
  });

  /* ⚠ THEIR ANSWER IS STILL RECORDED. The debt must not cost them the yes —
     portalRsvp writes it before anything is drawn, and RS-24 holds them on
     the money, never on the answer. */
  test('their yes is still recorded', async ({ page }) => {
    const stub = await openRsvpYes(page, withArrears(200, 2025));

    const calls = await stub.calls();
    const rsvp = calls.filter(c => c.name === 'portalRsvp');
    expect(rsvp.length).toBe(1);
    expect(rsvp[0].payload.response).toBe('yes');

    stub.assertNoRealCalls();
  });

  /* ⭐ REWRITTEN 2026-09-01. This used to assert a "Pay Last Season's Balance"
     button on a confirmation card. Dax: the RSVP buttons "should also
     automatically send the customer to their member portal", so that card is
     gone and there is no button to press — they are ALREADY on the page that
     button led to. The claim worth keeping is that the debt is put in front of
     them rather than left behind a generic link, and the portal's own card is
     a stronger version of it: the figure, what has been paid off it, and a way
     to pay, instead of one sentence. */
  test('lands in the portal with the balance in front of them', async ({ page }) => {
    const stub = await openRsvpYes(page, withArrears(200, 2025));

    /* The RSVP card is torn down, not merely covered. Left visible with its
       body classes on, the portal renders inside a cut-down layout. */
    await expect(page.locator('#rsvpConfirmCard')).toBeHidden();
    await expect(page.locator('#invBreakdown')).toBeVisible();
    await expect(page.locator('#invBreakdown')).toContainText(/still owing/i);

    stub.assertNoRealCalls();
  });
});

test.describe('RSVP yes from somebody who owes nothing', () => {

  /* ⚠ SILENCE IS THE FAIL-SAFE, and it is deliberately the opposite direction
     to the season hold. A customer wrongly told they owe money is worse than
     one not warned about a real debt, so anything the server cannot answer
     comes back as nought and the owing card is not drawn at all. */
  /* ⚠ AN INVOICE WITH NO CARRIED LINE AT ALL DRAWS NO LAST-SEASON CARD, not a
     card reading "settled" — the split-into-two-cards layout only appears once
     there is something carried to split off. So the claim here is ABSENCE, and
     asserting the settled wording instead fails on correct code: measured, the
     plain card reads "Installation … Payments received … Balance due" and
     nothing else. The settled wording is proved by the paid-off test below,
     which is the case that really does carry a line. */
  test('sees no mention of a balance', async ({ page }) => {
    const stub = await openRsvpYes(page);
    const card = page.locator('#invBreakdown');

    await expect(card).toBeVisible();
    await expect(card).not.toContainText(/still owing/i);
    await expect(card).not.toContainText(/can.t book your install/i);

    stub.assertNoRealCalls();
  });

  /* ⚠ A SETTLED DEBT IS NOT AN OUTSTANDING ONE. A carried line that has been
     paid off must read exactly like no debt at all, or every customer who
     cleared last season is warned about it for the rest of the year. */
  test('a carried balance they have already paid says nothing', async ({ page }) => {
    const paid = withArrears(200, 2025);
    const inv = paid.invoices[CUST.invoiceKey];
    inv.deposit = (Number(inv.deposit) || 0) + 200;

    const stub = await openRsvpYes(page, paid);
    await expect(page.locator('#invBreakdown')).toContainText(/is settled/i);
    await expect(page.locator('#invBreakdown')).not.toContainText(/still owing/i);

    stub.assertNoRealCalls();
  });
});


const { QUOTES } = require('./fixtures');

/* A quote linked to the standard customer BY ID, which is the only join the real
   quoteRespond accepts. ⚠ NEVER BY PHONE: 17 numbers in the real book are shared
   and 14 are two genuinely different households, so a phone join hands one house's
   debt to another family. */
function memberQuote(overrides) {
  const q = JSON.parse(JSON.stringify(QUOTES.alreadyApproved));
  q.id = 'quote-member-arrears';
  q.data.quoteToken = 'quotetokenarrears001';
  q.data.existingCustomerId = CUST.id;
  q.data.formCompleted = true;
  return Object.assign({ quotes: { memberArrears: q } }, overrides || {});
}

async function approveByLink(page, overrides) {
  const stub = await installFirebaseStub(page, overrides);
  const thrown = [];
  page.on('pageerror', e => thrown.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !BLOCKED_RESOURCE.test(m.text())) thrown.push('console: ' + m.text());
  });
  await page.goto('/index.html#/quote-details?token=quotetokenarrears001&action=approve');

  /* ⚠ A MEMBER IS ASKED A QUESTION FIRST, AND THESE TESTS HAD NEVER SEEN IT
     (2026-09-01). memberQuote sets existingCustomerId — correctly, it is the only
     join quoteRespond accepts — and that is exactly what makes the quote a MEMBER'S.
     handleQuoteLink's approve path tests res.alreadyMember BEFORE res.formCompleted
     and RETURNS, so a real member never reaches the formCompleted ending these
     assertions were written against. They landed there only because the stub did not
     return alreadyMember at all, so every one of them took the new-lead path.

     The wording under test is on the member ending too — the "No, keep everything the
     same" branch calls the same quoteScheduleSub — so the coverage is unchanged in
     substance. What changes is that it is now asserted on the screen the customer
     actually reaches, one step later.

     ⚠ AND THE STEP IS CONDITIONAL, not assumed: a quote that is NOT a member's still
     ends on approve, and forcing a click that no button exists for would fail here
     rather than where the difference is. */
  const keepSame = page.locator('#page-quote-details')
    .getByRole('button', { name: /keep everything the same/i });
  if (await keepSame.count()) await keepSame.click();

  stub.thrown = thrown;
  return stub;
}

test.describe('Approving a quote when last season is still owed', () => {

  test('does not promise to get them scheduled', async ({ page }) => {
    const stub = await approveByLink(page, memberQuote(withArrears(200, 2025)));
    const sub = page.locator('#quoteLinkConfirmSub');

    await expect(sub).toContainText(/before we can book the install/i, { timeout: 8000 });
    await expect(sub).not.toContainText(/be in touch to get you (on the )?schedule/i);

    stub.assertNoRealCalls();
  });

  test('and names the amount and the season', async ({ page }) => {
    const stub = await approveByLink(page, memberQuote(withArrears(200, 2025)));
    const sub = page.locator('#quoteLinkConfirmSub');

    await expect(sub).toContainText('$200.00', { timeout: 8000 });
    await expect(sub).toContainText('2025');

    stub.assertNoRealCalls();
  });

  /* ⚠ THE APPROVAL ITSELF IS UNAFFECTED. RS-24 holds them on the money, never on
     the answer — and their quote is genuinely approved. */
  test('the approval is still recorded', async ({ page }) => {
    const stub = await approveByLink(page, memberQuote(withArrears(200, 2025)));
    await expect(page.locator('#quoteLinkConfirmSub')).toContainText(/before we can book/i, { timeout: 8000 });

    const calls = await stub.calls();
    const approve = calls.filter(c => c.name === 'quoteRespond' && c.payload.action === 'approve');
    expect(approve.length).toBe(1);

    stub.assertNoRealCalls();
  });

  /* ⚠ SILENCE IS THE FAIL-SAFE HERE TOO. A member who owes nothing must read
     exactly what they always read. */
  test('a member who owes nothing reads the original wording', async ({ page }) => {
    const stub = await approveByLink(page, memberQuote());
    const sub = page.locator('#quoteLinkConfirmSub');

    /* ⚠ EITHER ENDING'S WORDING. The member branch says "get you ON THE schedule"
       and the formCompleted branch says "get you scheduled" — same promise, two
       phrasings. Pinning one made this fail on the other perfectly correct screen,
       which is the slow-fuse shape this repo keeps hitting. The claim under test is
       that somebody who owes nothing is still PROMISED an install. */
    await expect(sub).toContainText(/be in touch to get you (on the )?schedule/i, { timeout: 8000 });
    await expect(sub).not.toContainText(/outstanding/i);

    stub.assertNoRealCalls();
  });
});
