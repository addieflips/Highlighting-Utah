# Highlighting Utah — System Map

Written for Addie (non-coder) by Claude Code after a full read-through of `main` on 2026-08-08. This explains how the app actually works today, not how it used to work — where this disagrees with old notes or your own memory of a feature, trust this document (it was written by reading the real code) and flag it if something seems off.

---

## 1. The lifecycle, start to finish

1. **Public quote** — a visitor fills out the quote form on the public site. It's saved to `quotes` with `status: 'new'`. No photo is attached automatically anymore (see §9).
2. **Office prices it** — a staff member opens the quote card in Admin, fills in estimated feet and a quoted price, and clicks "Get Approval Link." This saves `quotedPrice` and a `quoteToken`, and generates a link like `https://highlightingutah.com/#/payment?token=...`.
3. **Customer approves** — the customer opens that link (no login needed) and approves or declines. This calls the `quoteRespond` Cloud Function, which is how an unauthenticated visitor is allowed to touch the `quotes` collection at all.
4. **Convert to customer** — a staff member clicks "Convert to Customer" on the approved quote and is asked which way:
   - **Convert automatically** — saves them there and then, using everything the quote already holds, without leaving the Quotes tab. The popup lists anything the quote is missing *before* it runs, and the result is reported in a toast (customer number, bin count, whether they reached the Warehouse, whether the $30 fee was charged, and anything still missing).
   - **Fill in manually** — opens the Add a Customer form already filled in, so the gaps can be typed in first. This is what the button used to do on its own.

   Both copy the same details (name, phone, colors, wire color, install timing, gate code, outlet timer, specific outlet, notes, wants-mailed-invoice, photo, contact method, the $30 set-up fee decision, and the *approved* price — never a recalculated one) and both create the `jobAddresses` document through the **same** Add Customer submit handler: automatic fills the form and submits it rather than writing its own record, so the customer number, invoice, warehouse build flag and auto-scheduling cannot drift apart from the manual path. The quote is marked `status: 'closed'` with `convertedToCustomerAt` set.

   *The light colours are what put them in the Warehouse* (`needsLightBuild` is set from `lightsDescription`), so conversion falls back to the quote's own wording when no colour boxes were ticked — otherwise a quote whose colours were typed as free text would convert with no description and never reach the build queue.
5. **Measured Feet drives everything** — see §2, it's the single highest-leverage field in the app.
6. **Warehouse builds it** — if the light pattern is set, `needsLightBuild: true` queues the house into the warehouse build list (grouped by color pattern, bundle count from feet).

   **Light colours are never free text.** Owner's rule, 2026-08-15: *"it should never have to guess because it should never be in typed format."* Every way a light description can be written is a picker — the customer's own detail form on the public site, the colour boxes on Add a Customer and Edit Customer, and the colour change in the Member Portal. The one free-text box that used to exist (`.quoteLightsInput` on the admin quote card) is gone, and run-all.js fails if anything like it comes back. The bulk importer is the one remaining way typed text can arrive, because it pastes a spreadsheet column.

   Records that still contain words are OLD data, from before that was true. Health Check lists them under **"Customer whose light colours are written as words"**, naming the exact part it could not read, so they get re-picked once instead of interpreted forever. That row deliberately has **no Fix button**: guessing what "red with tinsel" meant would change what the crew physically builds. The list should only ever shrink — a recently-added customer appearing on it means something has started writing free text again.

   *Grouping is deliberately forgiving about how the colours were written* (`whNormalizeLights` / `whColorsFromWords`, and an identical copy in employee.html). "Red, Green", "Green, Red", "red, green", "Red and Green", "Red & Green", "Red/Green" and "red green" are all ONE group — order, case, and the separator do not matter, and colours typed as words group with colours ticked in the boxes. Two things it will *not* do: it never merges a repeated-colour pattern into the plain set ("Red, Green, Red" stays its own build), and it never guesses at text it cannot fully read — "Red with tinsel" is left exactly as typed and keeps its own group rather than being folded in with plain Red. Wire colour is always part of the key.
7. **Route** — an install route is generated from unscheduled, geocoded, RSVP-yes customers, clustered geographically, and saved as a **frozen snapshot** (see §5). This flips `scheduled: true` on the customer.
8. **Crew installs** — the crew works Today's Route in the Crew Portal and marks each stop Done (or Flag Issue / Didn't Get To).
9. **Nightly invoice** — every night at 7 PM Mountain, any completed-but-not-yet-invoiced house gets billed automatically (§8).
10. **Payment** — the customer pays via PayPal (in-portal) or Venmo (deep link) from the Member Portal.
11. **RSVP "no"** — a flat "no" (not "back next year") sets `needsLightRecycle: true`, sending the house to the Warehouse Recycle queue.
12. **Recycle** — marking a house recycled in the warehouse clears its `customerNumber` and drops that number back into `availableCustomerNumbers` for reuse (lowest number first).

---

## 2. Fields that drive more than one thing

**Measured Feet** (`measuredFeet` on `jobAddresses`) is the single highest-leverage field in the app. One number drives:
- **Bin count**: a house needs another bin for every **260 ft**. Up to 260 → 1 bin; 261–520 → 2; 521–780 → 3; and so on. More than one bin means a **5000-series** customer number instead of a regular one — there are only two series, so a 3-bin and a 4-bin house both get a 5000 number, while the bin count saved on the customer is the real 3 or 4 so the warehouse builds the right amount. *(Note: some older docs and the Health Check UI call this "the 200 ft rule" — the cutoff in code is 260 ft, `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js. The 260 boundary has not moved; before 2026-08-15 the count simply stopped at 2, so a 900 ft house was built two bins short.)*
- **Warehouse bundle count**: `ceil(feet / 40)`.
- **Auto-priced estimate**: `price ≈ feet × perFootRate`, padded ~5% upward, never down.

Changing feet on an existing numbered customer warns before renumbering, rather than silently changing their bin/number out from under them.

**Light colors / pattern** (`lightsDescription`, `lightColors`) drives: the warehouse build queue membership and grouping, the $30 late-change fee (if changed outside the first 48 hours or after route assignment), and a "Lights Changed After Assignment" System inbox message if they were already on a saved route.

---

## 3. The money model

**The one correct formula, everywhere:**
```
owed = (install + removal + changeFees) − credits − deposit, floored at 0
```
This lives as `computeInvoiceStatus(install, removal, deposit, credits, changeFees)` in admin.html and is mirrored server-side in `functions/index.js`. As of this pass, every place in the app that computes a balance or status uses the full formula — that was **not** true before this pass (see the P0 fix in git history: `changeFees` had been left out of roughly 15 different call sites, including the actual PayPal charge amount).

**Two separate $30 fees, easy to conflate:**
- **New-member fee** — added once by the nightly Cloud Function for a customer's first season, flagged `newMemberFeeApplied` so it's never double-charged. It's folded directly into `install`, not tracked as a separate line.
- **Light-change fee** (`changeFees`, with itemized `changeFeeNotes`) — added by `portalSave` when a member changes their light colors outside a 48-hour grace window. Tracked as its own field, separate from `install`, so it can be waived/removed independently (there's a dedicated "Remove light-change fee(s)" button in the Invoices panel).

**Credits** (`credits`/`creditNotes`) never push the balance below $0 — anything left over becomes `carryoverCredit` on the customer, applied to their *next* invoice, not refunded.

---

## 4. Every Firestore collection, one line each

**Read/written directly by the browser** (staff-authenticated, `request.auth != null`):

| Collection | Purpose |
|---|---|
| `jobAddresses` | The customer record — almost everything hangs off this |
| `invoices` | Per-customer billing, doc ID = phone digits (or lowercase email if no phone) |
| `quotes` | Incoming quote requests |
| `messages` / `messageFolders` | Inbox (customer contact messages + internal "System" notices) and its folder tree |
| `scheduledRoutes` | Saved/frozen route documents |
| `crews` / `crewOverrides` | Crew roster config and one-day reassignments |
| `employeeNames` / `employeeCategories` / `roleTemplates` | Staff directory, custom labels, reusable portal-tab permission bundles |
| `employeeNotes` / `employeeRequests` | Notes on an employee; employee-submitted requests to the office |
| `timeLogs` / `timecardChangeRequests` | Clock-in/out records; correction requests |
| `dailyChecklists` | Daily warehouse/crew checklist state |
| `warehouseExtras` | Buffer/one-off warehouse build items outside the normal queue |
| `warehouseGoals` | Build-ahead production goals |
| `availableCustomerNumbers` | Pool of recycled bin numbers |
| `pricing` / `settings` | Per-foot rate config; misc singleton settings (EmailJS, nightly-automation toggle) |
| `emailTemplateFolders` / `emailTemplates` / `savedEmailTemplates` | Email template library |
| `customCodes` | Misc site-settings feature |
| `expenses` / `bills` / `budgetCategories` / `savingsGoals` / `debtAccounts` | Finance / Financial Overview tab |
| `creditCards` / `ccTransactions` / `ccPayments` / `ccRecurringOverrides` | Business Credit Cards tab |
| `paymentImports` / `paymentImportFolders` | Bank/payment CSV import history |
| `reviews` / `gallery` / `heroImages` / `faq` / `siteContent` | Public website content — publicly **readable**, staff-only to write |
| `projectPeople` / `projectTests` | Internal QA — the Test Checklist tab |
| `houseMaps`, `inventoryItems`, `smsTemplateFolders`, `smsTemplates`, `employeeMessages`, `teamMessages` | Present in the rules; no direct usage found in this pass in the three HTML files — likely legacy/reserved |

**Read/written only by Cloud Functions** (Admin SDK, bypass rules entirely — this is *how* the public site touches protected data without being logged in):

| Collection | Purpose |
|---|---|
| `portalRateLimits` | Sign-in / lookup attempt counters, to slow down guessing |
| `nightlyInvoiceLog` | Log of nightly billing runs — staff can read it, only the function writes (`allow write: if false`) |

`jobAddresses`, `invoices`, `quotes`, `messages`, and `scheduledRoutes` are touched by **both** sides — staff directly (authenticated), and the public/portal side only through Cloud Functions.

---

## 5. Routes in detail

**Candidate pool**: unscheduled, not completed, geocoded (has lat/lng), not locked by install-preference or an earliest-install date, not `lightsLocked`, and RSVP `'yes'`. Selection uses a greedy nearest-neighbor walk from a seed house (by chosen direction — east/west/north/south/dense/auto), then a 2-opt pass to tighten the order.

**Saved as a frozen snapshot** (`scheduledRoutes/{date}_{type}_{crew}`): each stop only freezes `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber`. Everything else (notes, wire color, light pattern, house photo, one-time note) is looked up **live** from `jobAddresses` when the route is displayed — on purpose, so a correction after scheduling still reaches the crew for those fields.

**Resync when a customer is corrected later**: two parallel implementations — one in admin.html (staff edits), one inside the server-side `portalSave` (customer edits their own info) — both scoped to **upcoming routes only** (a route dated before today is left alone as history).

**Crew side**: Today's Route in the Crew Portal loads `install` and `fix` type routes for the day. Marking a stop Done clears the one-time note and stamps `completedAt`. "Didn't Get To" sends the house back to the schedule pool with no invoice sent. *(Removal-day routes are generated and saved in Admin, but the Crew Portal's Today's Route loader only queries `install`/`fix` — worth confirming with whoever runs removal day whether they use a different screen, or whether this is a gap.)*

---

## 6. Customer Numbers

- **260 ft cutoff** (see §2) decides regular-series (1 bin) vs 5000-series (2 or more bins). Only two series exist, so the test is "more than one bin", not "exactly two".
- **Pool**: `availableCustomerNumbers`, one doc per free number, `{type, releasedAt, releasedFrom}`.
- **Assign**: lowest free pooled number of the right type wins; if the pool is empty, the next number above the current highest is used.
- **Release**: freeing a number (edit, removal, recycle) drops it back into the pool.
- **Bulk assign**: a paste-in tool that matches pasted names/streets/numbers against existing customers by normalized name/street and stamps the number on — it does not touch geocoding or addresses.

---

## 7. The three portals

### Public site + Member Portal (`index.html`)
- **Anonymous**: quote form, public content (reviews/gallery/hero images/FAQ/site content), general contact message.
- **Signed in** (phone-or-email + last name, or a personalized token link): Payment (balance + tip + PayPal/Venmo), Information (name/phone/email/address/gate code), Light Colors (subject to the 48-hour fee window), Changes (RSVP + preferences), Contact, Cancel (requests cancellation).
- **Cloud Functions it calls**: `portalLookup` (the one entry point for all lookups — token or phone/email+lastname, rate-limited), `portalSave` (whitelisted writes per section, mirrors changes onto the invoice, resyncs upcoming routes), `portalRsvp`, `portalInvoice` (sanitized invoice read), `quoteRespond`, `publicQuoteLookup`, `paypalCreateOrder`/`paypalCaptureOrder`, `publicConfig` (public-safe EmailJS keys for the contact form).

### Admin dashboard (`admin.html`)
Customers · Quote Requests · Customer Messages · Routes · Responsibilities (staff/crew/timecards) · Warehouse · Customer Numbers · Dashboard (Finance: Invoices, Business Credit Cards, Financial Overview) · Per Foot Pricing · Time Logs · Import Center / Member Export · Health Check · Automation (Email/SMS/nightly invoicing) · Reviews/Gallery/Hero Images/FAQ/Site Settings · Project To-Do / Test Checklist.

### Crew/Warehouse Portal (`employee.html`)
Home (role-specific dashboard) · Route (Today's Route) · Checklist · Time Card · Warehouse (Checklist/Lights/Recycle/Timers/Pull/Tomorrow subtabs) · More menu (role-gated: Warehouse, Add a Customer, Quotes, Messages, All Routes, Layout Maps, Crew Assignments, view-only Dashboard/Pricing/Time Logs) · Notes and requests to the office.

---

## 8. Everything automatic

- **`sendNightlyInvoices`** — cron, 7 PM Mountain daily (`0 19 * * *`). No-ops unless the automation toggle in `settings/nightlyInvoiceAutomation` is on. Bills any completed-but-uninvoiced house, texts the owner a summary via Twilio, logs to `nightlyInvoiceLog`.
- **`sendInvoicesNow`** — the same billing logic, on-demand, from an Automation-tab button — works even with the nightly toggle off.
- **`paypalWebhook`** — catches a payment capture the browser-side call might have missed (e.g. the customer closed the tab right after paying); signature-verified before it's trusted.
- Changing light colors in the portal auto-queues the warehouse build (`needsLightBuild`) when the pattern actually changed.
- A light-color change made **after** the customer is already on a saved route auto-drops a "Lights Changed After Assignment" message into the Admin inbox — a human still has to manually deal with the route.
- Deleting a scheduled route automatically frees the affected houses back to the schedule pool.
- RSVP "no" auto-flags `needsLightRecycle`; RSVP "back next year" does **not**.
- A legacy customer record without a `portalToken` gets one minted automatically the first time they're looked up.
- Nightly-run failures/results text the owner via Twilio — a separate channel from email, so it still works if email itself breaks.

---

## 9. Things that look automatic but aren't (or no longer are)

- **Quote photos**: Street View auto-lookup was retired. `frontPhotoUrl` is `null` on every new public quote — but it's *not* dead. Staff add/replace/markup the photo by hand directly on the quote card in Admin, and it carries across to the customer record on conversion. (An earlier internal note flagged the admin reads of `frontPhotoUrl` as dead code to remove — that note was wrong; removing those reads would have broken the working manual-photo feature. Confirmed by the code comment in `index.html`: "Automatic Street View photo lookup was retired — photos are added by hand on the quote card in the admin.")
- **One-time notes**: there used to be two disconnected fields — `oneTimeNotes` (plural, written by Add/Edit Customer, read by nothing) and `oneTimeNote` (singular, the one actually shown on route stops, read by the Crew Portal, and cleared when a stop is marked Done). Fixed in this pass — Add/Edit Customer now writes the singular field too, so a note entered there actually reaches the crew.

---

## 10. Firestore composite indexes

`firestore.indexes.json` defines 7 composite indexes, all supporting "filter one field, sort by another" queries: per-employee history feeds (`employeeNotes`, `timeLogs`, `timecardChangeRequests` — each `employeeName` + `createdAt`), pending-approval queues (`employeeRequests`, `timecardChangeRequests` — each `status` + `createdAt`), and route-type-by-date lookups (`scheduledRoutes` — `type` + `date`).

---

## 11. If X isn't working, check Y

- **A route/customer list is empty with no error** → check `firestore.rules` first for that collection. A collection missing a rules entry is denied by default and fails *silently* in a listener (no console error a non-coder would notice).
- **A field the portal should show is blank or stuck at 0** → check whether that field is in the relevant Cloud Function's *read whitelist* (`PORTAL_READ_FIELDS`, `INVOICE_READ_FIELDS`, `QUOTE_READ_FIELDS` in `functions/index.js`). The portal only ever sees a function's sanitized output, never the raw document — a field can be correctly written and still invisible to the customer if it's not on that list.
- **An invoice's balance/status looks wrong** → check whether `changeFees` is actually being included in that particular screen's math. This was the P0 bug for this pass; the formula is documented in §3 so any *new* code touching balances can be checked against it.
- **A route change (address, gate code, name) isn't reaching the crew** → check whether the route is *upcoming* — both resync paths deliberately skip past/history routes. Also remember only `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber` are ever frozen into a stop; other fields are supposed to be looked up live, so if one of *those* isn't updating, the live-lookup code itself is the place to check, not the resync.
- **Firestore is throwing `failed-precondition`** → almost always a missing composite index. The index (or rules) file being correct in the repo means nothing until `firebase deploy --only firestore:indexes` (or `:rules`) actually runs — Netlify never touches Firebase, and a correct file sitting undeployed looks identical to a wrong one from the app's point of view.
- **A customer's bin/number logic looks off at exactly 200 ft** → the actual cutoff in code is 260 ft, not 200 (see §2). Check `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js (they moved out of admin.html) before assuming a bug.
- **A big house shows fewer bins than it needs** → check whether the code doing the deciding tests `numberOfBins === 2`. Bins go up in 260s now, so a 900 ft house is 4 bins; `=== 2` reads that as "not a double" and hands it a regular customer number.
- **Firestore's "Fetch failed" / long-poll `Listen`/`channel` message in the console** → normal reconnection noise, not a bug.
