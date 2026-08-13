# Multi-property quotes, photos and billing — merged plan

*Written 2026-08-13. Merges `claude/multi-photos.md` (built) with the
multi-property build plan (not built). Checked against `main` at 20,925-line
admin.html. Hand this to a fresh chat — it is self-contained.*

---

## Project rules

- GitHub is the source of truth. Pull from
  `raw.githubusercontent.com/addieflips/Highlighting-Utah/main/` before any change.
- Do not rewrite, delete or replace existing features unless asked.
- Explain the plan and its knock-on effects, then wait for a go-ahead.
- Deliver finished work as full downloadable files, not code in chat. Give
  **only** the files that need uploading, not every file touched in the chat.
- Keep it simple and mobile-friendly. No new libraries.
- Stop immediately if usage hits 99%.

---

## What is already built (verified against main)

**Admin-side multi-photo — done.** `admin.html` has `quotePhotos`,
`housePhotos`, `photoFrameHtml`, `pcShow`, `pcActiveIndex`, `cloudEmailPhoto`.
`functions/index.js` has `quotePhotos`, `cloudEmailPhoto`,
`repeatQuoteButtonsServer`. Stacked labelled photos in quote emails, doubled
approve/decline buttons, photo #1 mirrored to the legacy flat fields.

**Crew portal — NOT done.** `claude/multi-photos.md` claims `employee.html` got
the read-only swipe frame. It did not ship. On main, employee.html line ~2600
still reads a single `d.housePhotoUrl`. The crew sees photo #1 only.

**Multi-property — nothing built.** Zero occurrences of `properties`,
`buildings`, `frontOfHouse`, `mapPhotoUrl`, `Add another address` anywhere.

**Public photo upload — does not exist.** The old build plan assumed
"photo uploads currently go through Cloudinary — reuse that pipeline." Wrong.
`index.html` has no Cloudinary code at all; `frontPhotoUrl` is hardcoded to
`null` on submit (~line 2281) because the Street View lookup was retired.
Cloudinary lives only in admin.html (`CLOUDINARY_CLOUD = "highlighting-utah"`,
`CLOUDINARY_PRESET = "highlighting_utah"`, unsigned). Public upload is net-new.

---

## The architecture decision that reshaped this plan

The original plan nested a second address inside one quote document
(`properties: [...]`). That collides with the whole system. These are all keyed
to **one `jobAddresses` record per address**: `customerNumber` (and its 5000 vs
regular series), bins (over 200 ft = 2), `measuredFeet`, `housePrice`,
`completed` (the flag that triggers billing), the route stop and its geocode,
warehouse bundles, `needsLightBuild` / `needsLightRecycle`, gate code, outlet,
install timing. Nest two addresses and you get one customer number for two
houses, one price, one `completed`, and a route stop you can't drive to.

**So the plan splits in two:**

- **Buildings nest.** A shop, shed or guest house at the *same* address is one
  drive, one crew visit, one number, one price. `buildings[]` inside the record
  is a photo and footage grouping, nothing more.
- **Properties do not nest.** A second address = a second quote and a second
  `jobAddresses` record, linked by phone.

### Billing: already solved, and it is NOT Bill To

`syncPayerInvoice` (admin.html ~11952) queries every `jobAddresses` with that
phone and no `billToPhone`, sums their `housePrice`, and writes one invoice.
Two houses under one phone already share a bill.

- **Bill To** = a *different person* pays (landlord, parent, property manager).
- **Second address** = *same person*, two houses.

Different reasons, same invoice document. No new billing mechanism needed.

---

## Phase 1 — Nightly billing fix (DONE 2026-08-13)

**The bug.** `runInvoiceBatch` looped house-by-house. When an invoice already
existed it reused `inv.install` as-is, so a second house's price was never
added, and the customer got one email per house showing the wrong amount. Any
existing customer with two houses on one phone was being under-billed.

**The fix, per Addie:** *send one invoice after the last house is installed.*

`runInvoiceBatch` now groups every house by payer key (`billToPhone` digits, else
`invoiceKeyFor`), then per payer:

- Houses with `rsvpStatus === 'no'` are dropped — otherwise one cancelled
  address holds the bill forever.
- Skip if every active house already has `invoiceEmailSent`.
- **Hold** if any active house has `needsFix` (→ `skippedNeedsFix`).
- **Hold** if any active house isn't `completed` (→ `skippedNotDone`).
- Otherwise bill once: `install` = sum of the group's `housePrice`, the $30 join
  fee applied once if any house qualifies, carryover credit drawn off the payer's
  record, one email, and `invoiceEmailSent` marked on **every** house in the group.

**Deliberately unchanged:** an existing *single-house* invoice keeps whatever
total the office put on it. Only multi-house payers get re-summed. Single-house
customers produce a byte-identical email — same total, wording and timing.

Multi-house emails get one `{{feet_line}}` block per address (bold address, then
its own installation line), so a combined bill still itemises.

Verified: grouping/hold logic tested across 11 cases (single done/not-done, two
houses one done, both done, one RSVP-no, one needs-fix, already billed, bill-to
joining the payer group, bill-to holding the payer, email-only key, no key).
`node --check` clean; everything outside the loop byte-identical.

---

## Phase 2 — Crew portal photo catch-up

Port `photoFrameHtml` / `pcShow` / `pcActiveIndex` into `employee.html` as a
read-only swipe frame (arrows + thumbnails, built for a phone), reading
`housePhotos` with a fallback to `housePhotoUrl` so old records behave
identically. Self-contained; blocks nothing.

---

## Phase 3 — Signed public photo uploads (Option B, chosen)

Unsigned was rejected: the preset name is visible in public page source, so
anyone could post files into the Cloudinary account.

- New Cloud Function returns a **one-time Cloudinary signature**, but only after
  validating the caller's `quoteToken` (or portal token) the same way
  `quoteSaveDetails` does. No valid quote, no signature, no upload.
- Needs the Cloudinary **API secret** in function config (never in client code).
- Browser: request signature → POST file to Cloudinary with it.
- **Client-side downscale before upload** — canvas resize to ~1600px, no library,
  ~15 lines. Phone photos are 3–12MB and a form can carry 8+ of them.
- Per-photo progress and a cap on photo count, or the form feels broken on mobile.

---

## Phase 4 — Buildings (nested, same address)

Per the approved mockup `multi-property-mockup.html` — build from it, do not
re-design.

- Four named side buttons: Front of house / Right side / Left side / All around.
  Tapping one opens the picker directly; the filled side's button retires;
  removing the photo brings it back.
- `+ Add another photo` (dashed, separate) always stays for anything else.
- `+ Add another building on this property` adds a block with its own name field
  and a fresh set of side buttons.
- **One general notes box** at the very bottom of the whole form. Not per
  building — per-building notes were tried and explicitly rejected.

**Do not reintroduce** (all rejected in the mockup session): a tile/grid photo
picker; a single generic "+ Add a picture" with an auto-guessed editable label;
a per-building note popup.

**Shape** (nested inside the existing quote / customer record):

```
buildings: [
  { id, name: 'Main house' | 'Shop' | ...,
    photos: { frontOfHouse|rightSide|leftSide|allAround: {url,original,markup}|null,
              extra: [ {url,original,markup,label} ] } }
]
```

Read-compatibility, no migration: if `buildings` is missing, treat the record as
one building ("Main house") holding `frontOfHouse: {url: frontPhotoUrl, ...}`.
Precedent is how `quotePhotos` handled the same problem in admin.html.

Touches: the public quote form + detail form in `index.html`; admin quote card
and customer record *display*; `quoteSaveDetails`' field allowlist in
`functions/index.js`; quote-to-customer conversion.

**Admin's own `quotePhotos`/`housePhotos` array feature is separate and stays
as-is.** This is about admin correctly rendering what the public site now sends.

---

## Phase 5 — Second address (sibling quotes)

`+ Add another address` on the public form creates a **second quote document**,
not a nested array. Siblings share a `quoteGroupId`. The added property gets the
Google Maps reminder + its own photo chip (shown only on added properties, never
the first).

### One email, combined price — decided

Each address keeps its own `quoteToken`, so each already has its own approve
link. No new token machinery.

- Email lists both addresses, each block showing **its own price**, with its own
  Approve / Decline pair underneath.
- A single **Approve both** above and below the block (reuse the doubled-button
  logic already built for stacked photos in `buildQuoteEmailHtml` /
  `repeatQuoteButtonsServer`).
- The combined total is labelled as the both-addresses figure, so declining one
  still leaves a number that makes sense.
- `quoteRespond` gains one option: approve just this token, or approve every
  quote sharing its `quoteGroupId`.

### Decline — decided

Keep the current one-tap decline **and** add an optional note box before submit,
for "actually I want a quote for something you didn't quote." The note lands in
the Inbox as a decision item, not the System folder.

### Detail form after a partial approval — assumed, confirm

One form covering the approved addresses with a **"same for both" tick, on by
default**, and a toggle to split when they genuinely want different colours.
The alternative (one form per address, in sequence) is always correct but
longer and gets abandoned.

### Conversion

Converting sibling quotes creates **separate `jobAddresses` records**, each with
its own number, bins, feet, price and route stop. Same phone on both = one
combined invoice automatically (Phase 1). No `billToPhone` involved.

---

## Phase 6 — Member Portal address picker

One house: the portal looks exactly as it does today, nothing changes.
Two or more: a row of address tabs at the top, everything below applies to the
selected one.

- **Shared, above the picker:** name, phone, email, contact preference, and the
  balance — one bill covering both, matching the invoice grouping.
- **Per address, below it:** colours, wire, outlet timer, gate code, install
  timing, notes, photos, buildings.

**RSVP must be per address** — they can keep the cabin and cancel the main
house — which means the RSVP email links need to be per address too. That
overlaps the queued RSVP rebuild (No / Back Next Year / Yes); land them together
rather than letting them fight.

Backend: `portalLookup` returns the sibling list instead of one house;
`portalSave` takes a house id. The $30 light-change fee and the 48-hour
`lightsLockedUntil` stay **per house** — already correct.

---

## Test impact

Bump versions and write a `retestReason` for any test touching: quote
submission, the detail form, quote-to-customer conversion, quote emails/nudges,
and **nightly billing** (Phase 1 changed it). New tests needed for:

- Two houses one phone → one invoice, correct sum, sent only after the last one
- A house RSVP'd 'no' does not hold up its payer's bill
- A house needing a fix does hold up its payer's bill
- Single-house customer email unchanged
- Multiple buildings on one property
- Two addresses on one quote group; approve one, decline the other
- Google Maps photo appears on an added property only
- An old single-photo quote still displays and converts

---

## Deploying

- `functions/index.js` → GitHub Actions (`deploy-functions.yml`) auto-deploys on
  push to `main`. **Deploy this before any HTML that depends on it.**
- `index.html` / `admin.html` / `employee.html` → commit + push → Netlify.
- No `firestore.rules` change anticipated: `quotes` and `jobAddresses` are being
  restructured internally, not replaced. Confirm when the signed-upload function
  is written. Remember `quotes` is create-only for the public — every customer
  write must go through a Cloud Function, since a portal token is not Firebase auth.
