# Highlighting Utah — System Map

Written for Addie (non-coder) by Claude Code from a full read-through of the real code. This explains how the app actually works today, not how it used to work — where this disagrees with old notes or your own memory of a feature, trust this document and flag it if something seems off.

**Kept current with every change, not regenerated occasionally** (Addie, 2026-08-26: "system map should be every time"). First written 2026-08-08; last brought up to date **2026-08-26**. ⚠ It is UPDATED rather than rewritten from scratch — a wholesale regenerate loses the hard-won detail in it and risks introducing errors into the one document written to be trusted. If a section here contradicts the code, the code is right and this is a bug in the map.

---

## 1. The lifecycle, start to finish

1. **Public quote** — a visitor fills out the quote form on the public site. It's saved to `quotes` with `status: 'new'`. No photo is attached automatically anymore (see §9).
2. **Office prices it** — a staff member opens the quote card in Admin, fills in estimated feet and a quoted price, and clicks "Get Approval Link." This saves `quotedPrice` and a `quoteToken`, and generates a link like `https://highlightingutah.com/#/payment?token=...`.
3. **Customer approves** — the customer opens that link (no login needed) and approves or declines. This calls the `quoteRespond` Cloud Function, which is how an unauthenticated visitor is allowed to touch the `quotes` collection at all.
4. **Convert to customer** — a staff member clicks "Convert to Customer" on the approved quote and is asked which way:
   - **Convert automatically** — saves them there and then, using everything the quote already holds, without leaving the Quotes tab. The popup lists anything the quote is missing *before* it runs, and the result is reported in a toast (customer number, bin count, whether they reached the Warehouse, whether the $30 fee was charged, and anything still missing).
   - **Fill in manually** — opens the Add a Customer form already filled in, so the gaps can be typed in first. This is what the button used to do on its own.

   Both copy the same details (name, phone, colors, wire color, install timing, gate code, outlet timer, specific outlet, notes, wants-mailed-invoice, photo, contact method, the $30 set-up fee decision, and the *approved* price — never a recalculated one) and both create the `jobAddresses` document through the **same** Add Customer submit handler: automatic fills the form and submits it rather than writing its own record, so the customer number, invoice, warehouse build flag and auto-scheduling cannot drift apart from the manual path. The quote is marked `status: 'closed'` with `convertedToCustomerAt` set.

   *The light colours decide WHICH build group a house lands in, not whether it is queued at all.* Conversion still falls back to the quote's own wording when no colour boxes were ticked, so a pattern typed as free text is not lost. ⚠ **Corrected 2026-08-26:** this used to say `needsLightBuild` was set FROM `lightsDescription`. It is not, and has not been since 2026-08-21 — every new house is flagged, colours or no colours (questions map WH-17, WH-20). A house with no colours goes to the warehouse's own "Waiting on light colours" block, which is visible and has an Add colours button; leaving it unflagged made those houses invisible instead, which was the bug.
5. **Measured Feet drives everything** — see §2, it's the single highest-leverage field in the app.
6. **Warehouse builds it** — `needsLightBuild: true` queues the house into the warehouse build list (grouped by colour pattern, bundle count from feet). It is set for **every** newly created house, by all six routes that create one — Add a Customer, quote conversion, the sheet sync, both bulk importers and the test-record builders. A house with no colours yet is queued too, and shown in the blocked "Waiting on light colours" block rather than dropped.

   **Light colours are REQUIRED, on both forms.** Owner's rule, 2026-08-15. The customer's own detail form has always refused to submit without one; Add a Customer now refuses too. It is the single field on that form that cannot be waved through with "add them without these" — everything else genuinely can wait (the photo gets taken next week, the price is still being agreed), but a customer with no colours is invisible to the Warehouse, because the build queue is keyed off the light description. They never reach Dad and no screen says so. Knock-on: **Convert automatically is disabled** for a quote with no colours, and says why, rather than letting you click it and get an error back — that quote has to go through **Fill in manually**, which has the colour picker on it.

   **Light colours are never free text.** Owner's rule, 2026-08-15: *"it should never have to guess because it should never be in typed format."* Every way a light description can be written is a picker — the customer's own detail form on the public site, the colour boxes on Add a Customer and Edit Customer, the colour change in the Member Portal, and **the Warehouse's own "Add to Queue" form**, whose Pattern field is a row of colour buttons: clicking a colour appends it, clicking it twice repeats it (that is how `Warm White, Red, Red, Warm White` is built), and each chip has an × to remove that position. `#whExtraPattern` survives as a *hidden* input because the rest of that form reads and writes it — everything now goes through `whSetExtraPattern()` so the chips and the saved value cannot drift apart. Two free-text boxes used to exist and both are gone: `.quoteLightsInput` on the admin quote card, and the Warehouse Pattern box. run-all.js fails if either comes back. The bulk importer is the one remaining way typed text can arrive, because it pastes a spreadsheet column.

   Records that still contain words are OLD data, from before that was true. Health Check lists them under **"Customer whose light colours are written as words"**, naming the exact part it could not read, so they get re-picked once instead of interpreted forever. That row deliberately has **no Fix button**: guessing what "red with tinsel" meant would change what the crew physically builds. The list should only ever shrink — a recently-added customer appearing on it means something has started writing free text again.

   *Grouping is deliberately forgiving about how the colours were written* (`whNormalizeLights` / `whColorsFromWords`, and an identical copy in employee.html). "Red, Green", "Green, Red", "red, green", "Red and Green", "Red & Green", "Red/Green" and "red green" are all ONE group — order, case, and the separator do not matter, and colours typed as words group with colours ticked in the boxes. Two things it will *not* do: it never merges a repeated-colour pattern into the plain set ("Red, Green, Red" stays its own build), and it never guesses at text it cannot fully read — "Red with tinsel" is left exactly as typed and keeps its own group rather than being folded in with plain Red. Wire colour is always part of the key.
7. **Route** — an install route is generated from unscheduled, geocoded customers who are IN the season, clustered geographically, and saved as a **frozen snapshot** (see §5). This flips `scheduled: true` on the customer.

   ⭐ **Who is "in the season" changed on 2026-08-26, and it is the single biggest switch in the app.** Addie: *"can we just make RSVP hardcoded to only people that RSVP either through the email, member portal or we put it in on costumer tab are they able to be scheduled for this year and invoiced."* Only somebody who has actually ANSWERED yes is routed, scheduled, built for and invoiced. **It is the rule, not a setting** — she confirmed that on 2026-08-27, and the Dashboard control that used to be able to turn it off is gone (RS-17). **It applies always**: it does not wait for the RSVP to be marked sent (RS-22). Everybody who has not answered is off the routes today, and they are listed by town with phone numbers under **Schedule › Waiting on RSVP** so an empty season is a stack of calls rather than a screen full of nothing. There used to be a third — a 14-day reply window — and she removed it: *"a house won't be a yes or no because of how long they haven't responded for. They are just unresponsive and we won't do there house unless we get a yes from them"* (questions map RS-15).

   ⚠ **What this looks like today.** The season is near-empty and refills as replies arrive. That is the rule working, not a fault. Marking the RSVP sent **moves nobody** — it changes what the waiting list SAYS about them, from *nobody has asked them* to *they have not replied*, which is a completely different phone call. The Dashboard names them too, and points at the list. It fails towards keeping people IN: anything unknown — no marker, a read that has not landed — leaves everybody in the season, because dropping somebody who wanted lights is the expensive mistake and carrying somebody who did not costs one bundle.
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

**Where Measured Feet comes from — the Measure Roof tool (rewritten 2026-08-27/28).**
You trace the roofline on the **sky view** and nowhere else. Each dot is lettered
A, B, C… and the footage is the distance between them on that one overhead
picture. Street View is for the customer's photograph and for reading a roof's
grade — it does not place a dot and never draws the sky view's.

Overhead cannot see HEIGHT, and height only lengthens a line where the roof
*climbs*. That is what **peaks** answer: you say which two lettered dots a peak
sits between, the tool takes you to a street view aimed at that gable, you drag
along the sloping edge, and it **asks** whether that reading was right before
adding anything. Saying yes adds the extra feet — Pythagoras on that grade, both
sides of the gable assumed the same. Saying try again changes nothing.

⚠ **The price is not worked out from the measured feet directly.** It uses
`feet × RM_FEET_MULTIPLIER`, which is **1.15** as of
2026-08-28 — read it off that constant, never off prose about it. It began life
compensating for the tool measuring short; it is now where the MINIMUM JOB COST
lives ($2/ft is the advertised rate and a 60 ft house cannot be done for $120),
and its size is the owner's dial — 2.9 → 1.45 → 1.3 → 1.15. Both numbers are
shown on the panel as separate lines. See Q-024.

⭐ **She sets it by naming the rate, not the dial** (2026-08-28): *"change it to
$2.30 a real foot on medium and adjust accordingly for hard and easy"*, with
*"the length of a foot is the only variable so still label it as $2 a foot"*. So
the rate box stays $2.00, the invoice keeps saying $2.00/ft, and this constant is
what moves. **What a house is actually charged, per REAL foot: easy $2.13,
medium $2.30, hard $2.53.** To change that again, move this constant — raising
the rate box instead would change the figure printed on the customer's invoice,
which is the one thing she has fixed.

⚠ **And it is not only a price — it is saved as the customer's footage.** That
same inflated figure sizes the bins at 260 ft, picks the number series and counts
the bundles at 40 ft, so a 230 ft house is filed as 265 and can be given a second
bin and a 5000-series number it does not need. Dropping the dial from 1.3 to 1.15
narrowed that; it did not remove it. The clean fix is to store the true footage
and apply the multiplier to the MONEY only — offered, not yet decided.

**Street View has its own dots.** Click the picture and it takes a mark of its
own, numbered 1, 2, 3… and visible only there — the sky view's lettered dots
never appear on it. A mark is a *direction* from the camera rather than a place,
so it needs no depth and sticks to the photograph as you pan and zoom; it belongs
to the one panorama it was placed in, and it reaches no footage and no price.
Backspace takes back a dot from whichever picture you were last working in.

**Enter ends a strand, in whichever picture you are working in.** Up in the sky
view that has always split the top of the house from the bottom. Street View
marks now do the same: without it every mark joined to the one before it, so
marking the top of a house and then the bottom drew a line straight across the
photograph. Enter with nothing marked does nothing, and a strand can only be
finished from the camera it was marked in.

**What Easy, Medium and Hard cost.** $1.85, $2.00 and $2.20 a foot — set as
multipliers of whatever Per Foot Pricing says, so that box stays the one number
to change. **The grade is scored on three things and size is not one of them:**
steepness (the pitch, and whether a real share of the roof is steeper still),
walkability (a two-storey or three-storey eave, and how many separate roof
sections there are) and how many strands. A big house already costs more for
being big — it is feet times a rate — so grading it up as well would charge
twice for one fact. Steepness counts most: a roof steep enough to rope onto is
Hard on its own, whatever else is true. One awkward thing on its own is *noted
and not charged for*; it takes two before the price moves.

**And the grade re-cuts itself as you measure.** Google's roof model gives the
first answer; every peak grade read off the street photo replaces it, so the
difficulty can change while you work. ⚠ Once you pick a difficulty yourself,
nothing overrides it — the tool stops re-cutting and leaves your answer alone.


**The whole tool sits on one screen and nothing on it moves.** The card is one
viewport tall and never scrolls; the two pictures take whatever height the bars
above and below them do not. That is what makes it fit whatever the window size —
but it also means anything that GROWS above the pictures moves them, and measuring
is exactly when things grow. So the bar holding the tools has a **fixed** height
rather than a minimum, every line that changes as you work (the dot count, the
notes) is held to one line with the full text in a tooltip, and the Save block is
on screen from the start showing "—" with its button disabled rather than
appearing once there is footage. The map's top does not move from the moment the
tool opens.

⚠ The one-screen rule has a floor, and it was learnt the hard way twice on the
live page. The stage holding the tools and the pictures GROWS to fill the card, but
it may never be squeezed below the rows inside it: a flex item that is too small
does not scroll, it OVERFLOWS and paints over whatever comes next — which drew the
Save bar and the Attach to Quote row on top of each other. If everything genuinely
will not fit, the CARD scrolls; nothing is ever hidden underneath something else.

**Recentre puts the camera back**, and it is also the way out of a pane that has
got stuck: it frames what you have already traced (falling back to the house when
nothing is down), re-aims Street View at the house, and clears the "finding the
house" cover. **Each picture has its own full-screen button** in its title bar —
Google draws one inside the map, but the sheet that catches measuring clicks
covers it, so it is visible and unreachable.

⚠ **The order on that column is load-bearing: tools, house, price, Save.** It is
set explicitly on each one, because a catch-all sends anything unnumbered to the
bottom — and when an edit dropped the pictures' number they went last, below the
Save bar and Roof Facts, off the bottom of the window. The tool looked like it had
no house.

⚠ **The pictures have a floor, and the card can scroll as a last resort.** Letting
them shrink is what makes the tool fit any window — and unchecked it let them
shrink to NOTHING: on the live site, where the Roof Facts panel renders (Google's
Solar API answers there and refuses on localhost), the last of the height went to
that panel and the tool opened with a toolbar, a Save bar and **no house at all**.
A picture that is smaller than you would like is a compromise; a picture that is
not there is a broken tool.

⚠ **The map is told when its pane changes size** (a `ResizeObserver`). A
flex-sized pane reaches its real height after the map is built, and Google answers
`getBounds()` with `undefined` until it has idled at that size — without those
bounds a click cannot become a place and **no dot can be placed at all**, with
tiles on screen and nothing appearing to be wrong.

⚠ **A dot cannot be edited once placed.** No clicking it, no dragging it;
backspace takes the last one back. Two dots may sit on top of each other, which
is what a roofline doubling back on itself needs.

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

**The reconcile sweep, and the one answer to "what town is this day"**: the sweep evicts stops that no longer belong (`stopProblem`), caps days that run over the crew limit (`evenOutDays`), then tops up short ones (`fillDays`). All three judge a house against **`routeDayTowns(day)`** — the day's full allowed town list (`day.towns`, falling back to `day.city`, so a route saved before `towns` was stamped behaves exactly as it always did) — and judge the house itself through `extractCleanCity`, the same cleaning step 1 uses. They used to disagree: eviction read the allowed list while the cap and top-up read `routeCityOf()`, the *commonest* town actually on the day. On a day stamped one town but carrying a legitimately borrowed house those two return different towns, so step 1 evicted a house and step 3 put it straight back — every sweep, indefinitely. `evenOutDays` and `fillDays` take the town lookup as an optional last argument; omit it and both behave precisely as they did before.

*Naming*: `routeDayTowns` is deliberately **not** `dayTownList`. A separate `dayTownList` exists further down for the timing sweep, answering a different question about a different shape of object (a day of `.houses`, not a saved route). Two top-level declarations of one name do not coexist in a browser — the later one wins for the whole page.

**Duplicate System notices**: `reconcileNoteIsRepeat` suppresses a word-for-word identical "Routes Kept Up To Date" note inside an hour (`RECONCILE_NOTE_REPEAT_MS`). It is guarded twice — an in-memory record, and a scan of `allMessages` so a reload, a second tab or the other office machine doesn't reopen the hole. It suppresses the *notice*, not the sweep: a backstop, not the fix, and it logs a console warning naming the loop rather than going quiet.

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
- **Only people who answered yes are scheduled or invoiced**, from the moment the RSVP goes out (see §1 step 7, questions map RS-15 and RS-17). Waiting does not turn an unanswered customer into a yes, and there is no switch — the only lever is whether the RSVP has been marked sent.
- **A yes comes from exactly three places**, and all three stamp a real reply: the member portal, the RSVP email link, and the office marking it on the customer's record. A bare stored `rsvpStatus: 'yes'` with no reply date behind it is *not* an answer — that shape comes from an import, a hand-edit, or the assumed yes written when a quote is converted, and `effectiveRsvpStatus` deliberately distrusts it (RS-19).
- **No email address is not an exception.** They are skipped by the send (counted, never silently), so they never answer, so they are never scheduled. Addie, 2026-08-27: *"anyone that doesn't have an email I don't want you to worry about those people... there are no exceptions."* Find them under **Customers → Filters → Email** (RS-18).
- **A customer converted from a quote this year is the one exception**, for two independent reasons she gave: converting *is* the approval, and they are deliberately never sent an RSVP (asking a first-year customer "will you be getting lights hung *again* this year?" reads wrong). It expires by itself — Start New Season clears the flag and the quote-join year is compared against the current year, so in 2027 they answer like anybody else. They carry an **"Approved — new this year"** badge beside their RSVP pill so the office can see why they are in without a reply (RS-20, RS-21).
- A legacy customer record without a `portalToken` gets one minted automatically the first time they're looked up.
- Nightly-run failures/results text the owner via Twilio — a separate channel from email, so it still works if email itself breaks.

---

## 9. Things that look automatic but aren't (or no longer are)

- **Quote photos**: Street View auto-lookup was retired. `frontPhotoUrl` is `null` on every new public quote — but it's *not* dead. Staff add/replace/markup the photo by hand directly on the quote card in Admin, and it carries across to the customer record on conversion. (An earlier internal note flagged the admin reads of `frontPhotoUrl` as dead code to remove — that note was wrong; removing those reads would have broken the working manual-photo feature. Confirmed by the code comment in `index.html`: "Automatic Street View photo lookup was retired — photos are added by hand on the quote card in the admin.")
- **The two opt-out flags, and what each one does NOT stop.** Both live on `jobAddresses` and both are deliberately narrow.
  - `smsOptedOut` (+ `smsOptedOutReason`) — set automatically when somebody replies STOP to a text, or by hand via the **Don't text this customer** tick in Edit Customer. It hides the "Send as text instead" button on the quote card. It does not affect email.
  - `noAutomationEmails` — the **do-not-send list** (added 2026-08-21). Set two ways, both writing the same field: the *Don't send* button beside a name in Automation Emails → Preview & Send, or the **Don't send this customer marketing emails** tick in Edit Customer. Cleared by *Allow again* in that panel's "Show who I've excluded" view, or by unticking. Read by exactly two places, both of them automation-email senders: the Preview & Send recipient list and the older Send Template modal. Somebody on it is dropped from both lists before rendering, so **Select All cannot reach them**, and both send loops check again at send time in case a row was ticked just before they were added.
  - **Where a preference is visible.** `CONTACT_PREFS` in `admin.html` is the one list of ways somebody has asked not to be contacted, and three screens render from it: the two tickboxes in Edit Customer, a red chip per preference on the All Customers row, and a muted line on the printed invoice (*"Contact preferences: no text messages."*). Somebody who has asked for nothing gets no line at all — printing "preferences: none" on every invoice trains the eye to skip the place the real ones appear.
  - ⚠ **The invoice prints preferences and can never act on them.** `contactPrefsNote(d)` returns a finished string, and `buildInvoiceDocHtml` is handed that string rather than the flags — so nothing in the invoice builder can branch on a contact preference, because it never receives one. Suite 128 asserts the builder names neither field directly. The Edit Customer tickbox says outright that they still get their invoice and account notices, since the one dangerous misreading of that box is that it stops their bill.
  - ⚠ **`noAutomationEmails` never stops a bill.** It is named for its scope on purpose — the obvious name (`emailOptedOut`) invites someone to wire it into the nightly invoice run, and a customer who asked to stop getting marketing would then silently stop being **billed**. Nobody chases an invoice that was never sent. Neither `functions/index.js` nor `buildInvoiceDocHtml` has ever heard of the field, and Suite 128 of `run-all.js` fails if either learns it.
  - ⚠ The four other email-send handlers in `admin.html` (`sendRsvpEmailBtn`, `sendBulkUpdateEmailBtn`, `pibSendUnpaidBtn`, `pibSendPaidBtn`) have **no markup** — every id is in `KNOWN_MISSING_IDS`, so they return at their first line. That is the only reason they carry no guard. Suite 128 fails if any of them ever gets markup, so whoever builds one has to decide about the list first.
- **Who can actually be emailed** (`custCanBeEmailed`, added 2026-08-21). An invoice only ever goes out by email, and Automation Emails drops anyone without an address before any other filter runs — so a customer with no email silently misses their bill *and* every RSVP. **All Customers → Filters → Email** finds them ("No email — cannot be contacted"), and a red **No email** chip marks them on the row.
  - ⚠ **Only the primary `email` field counts.** Every sender reads `d.email` — the nightly invoice run, both automation-email senders, the quote nudge. `email2` exists so a customer can *sign in* to the portal with it and is never written to, so a record holding only a secondary address cannot be emailed by anything at all. Those rows get an amber **Secondary email only — move it up** chip instead, because "No email" beside a visibly present address reads as a bug rather than as a field to fix.
  - **Automation Emails → Preview & Send says it too, at the moment of sending.** The recipient list used to drop these people on its first line, before any filter ran, so the count read *"312 members match these filters"* whether it had dropped nobody or forty — an RSVP that missed forty people looked exactly like one that reached everybody. They now flow through every filter and are removed at the end, and the count line reports it: *"— 40 left out: no email address on file. Find them under Customers → Filters → Email."* Nobody's mail changed; they were already excluded and should be.
  - ⚠ The exclusion is **not** applied in the do-not-send **manage view**, or somebody with no email who is also on that list would be hidden from the one screen that could take them off it. And an empty recipient list says they matched but cannot be written to, rather than "no members match these filters", which would send the office back to check filters that were fine.
  - Health Check's *"Customer with a phone but no email address"* answers a related but different question: it groups by **payer** and skips anyone who RSVP'd no, because it is about whether a **bill** can go out. The Customers filter is per-customer and includes everybody.
- ⚠ **Every select in the All Customers filter panel must be named in the change-listener array** (`['allCustFilterCity', …].forEach`). `allCustFilterLights` was missing from it from the day it shipped until 2026-08-21: the filter logic was correct and unreachable, so picking "On soft (needs switching)" redrew nothing unless you happened to touch another filter afterwards. Suite 73 passed throughout, because it lifts the filter block and runs it directly and never asked whether the control was connected. Suite 128 now asserts every select is wired, and that Clear Filters resets every one of them.
- **One-time notes**: there used to be two disconnected fields — `oneTimeNotes` (plural, written by Add/Edit Customer, read by nothing) and `oneTimeNote` (singular, the one actually shown on route stops, read by the Crew Portal, and cleared when a stop is marked Done). Fixed in this pass — Add/Edit Customer now writes the singular field too, so a note entered there actually reaches the crew.

---

## 10. Firestore composite indexes

`firestore.indexes.json` defines 7 composite indexes, all supporting "filter one field, sort by another" queries: per-employee history feeds (`employeeNotes`, `timeLogs`, `timecardChangeRequests` — each `employeeName` + `createdAt`), pending-approval queues (`employeeRequests`, `timecardChangeRequests` — each `status` + `createdAt`), and route-type-by-date lookups (`scheduledRoutes` — `type` + `date`).

---

## 10. Health Check — and ruling on what it finds

Since 2026-08-27 every finding carries **Not a problem** and, where the check has a fix, **Fix this one**. That was Addie's own ruling from 21 August and the reason she had stopped opening the panel: *"I can't mark anything as completed or outside of policy."*

A denial is **scoped to that customer and those exact values** — it is keyed on a fingerprint of the check, the name and the detail — so it lapses by itself the moment their data changes and the finding comes back. Nothing expires it and nobody has to remember it. Denied findings leave the badge and the list, and the panel says how many it is holding back, so a clean book never looks the same as a hidden one.

⚠ **`firestore.rules` gained `healthCheckDecisions`**, and that file is *not* deployed by CI. Until `firebase deploy --only firestore:rules` is run, every decision will look saved and none will be — a collection missing from the rules is denied by default and fails silently in a listener.

---

## 10a. `js/grid.js` — parked, not wired

718 lines that would build a crew-day out of a **patch of map** instead of a town. It is on `main` and **nothing imports it**: the season is still built from towns. It was brought across on 2026-08-27 only to stop it decaying on a branch that no longer shares any history with main — the file itself conflicts with nothing.

Whether it ever gets used is **Q-023**, which is open: Addie ruled *"city lines arent a concern"* on 22 August and then spent 24–26 August ruling in detail the other way (one crew, one dominant city plus at most one neighbour). `grid-parked.test.js` runs it on every build so it stays provably correct while it waits.

---

## 10b. The connections map — what reaches what

**Sidebar › Project › Connections**, its own item directly under Checklist — and at `connections.html` on its own if you want it full screen. **One tab, two views**, built to Addie's own mockup (`connections/mockup.html`, 2026-08-27 — build to it, do not redesign it). It was a tab INSIDE Checklist until 2026-08-27 and Addie could not find it, which for a reference is the same as not having it. **Where things go** is a grid: every watched field down the side in the words on the form, the record it is stored on (Customer or Invoice), and the eight places it lands across the top. A filled square writes it, an outlined one reads it, red is declared-and-missing, amber is found-and-never-declared. **Rules** is her own rulings — `claude/questions-map.md`, parsed and grouped by area, never a second copy — so a block on that page is always a judgement she made. It is generated by `connections/build.js` from a hand-written list in `connections/manifest.js`. Opening a rule shows the ruling itself and a **Looks right** / **Something's wrong** pair, and **what you decide is kept** (`ruleDecisions`, one document per ruling, written by the admin page the frame is sitting in). Three things about it are deliberate. A confirmation is about a **wording**, so if that ruling is later rewritten the row reads *changed since confirmed* rather than staying green — your tick must never vouch for words you have not read. The pill only moves **if the write landed**; refused, the row stays as it was and says why. And opened full screen in its own tab there is no admin page behind it, so it says decisions will not stick there rather than taking one it cannot keep. ⚠ The **N of M confirmed** figures count YOUR review — until 2026-08-27 one field carried both that and the ruling's standing in the questions map, so the page reported 8 of 181 confirmed when nobody had confirmed anything.

⚠ **THE TWO HALVES KEEP THEMSELVES CURRENT DIFFERENTLY, AND ONLY ONE OF THEM DOES IT BY
ITSELF.** Rules is parsed from the questions map every build, so a ruling answered today is
on the page today with nobody remembering to add it. The grid is hand-written: a field
nobody has declared cannot fail anything, so **a green grid is never evidence that new work
is wired** — it is evidence that nothing declared is broken. Asked on 2026-08-29 whether
the page had picked up the five new dates, the answer was no on that half, and the fix was
to declare them, not to read the green as a yes.

⚠ **AND THE FIVE DATES ARE ON THE NOT-WATCHED LIST RATHER THAN THE GRID, WHICH IS THE
FINDING.** Writing the spines is what surfaced it: R-010 refuses a spine that declares a
writer and no reader, and every one of `lightsQueuedAt`, `lightsRecycleRequestedAt`,
`assignedCrewAt`, `fixRaisedAt` and `newMemberFeeAppliedAt` is written by real code and read
by nothing. That is not loose wiring — it is the customer history that will read them not
being built. The gate was right and the spines were wrong, so they were kept out rather than
forced through with an invented reader, which would be the false green the whole page exists
to prevent. `connections.test.js` now names all five and fails if one is on neither list.

⚠ **A LOOKUP TABLE IS NOT A WRITER.** The change log names every editable field in a label
map (`housePrice: {label: 'House price', …}`), and the scanner reads `name:` as a write — so
ten of those rows counted as ten new writers of ten watched fields. Nothing went red, because
an undeclared touch lands in amber and nothing gates amber: the page just grew ten rows that
were never writes, and amber carrying rows that are fine is amber nobody reads. `scan.js`
blanks those tables by name, the same way it blanks comments and for the same reason, with
offsets preserved.

Two lists, and the picture is the difference between them: **declared** (what ought to connect — only a person knows this) against **found** (what the code really does, re-derived on every run). Green is both. **Red is declared and gone, and it fails the build**, so a break cannot be merged and cannot reach the website. Amber is code touching something nobody declared — worth seeing, never a failure.

It watches the fields most likely to disagree with themselves, ranked by how many separate places WRITE each one — Addie, 2026-08-26: *"what are most important most likely to fail. For example quotes, invoices, costumers, schedule, and routes"*, and then *"oh and warehouse"*. Eighty-two fields in those six areas have more than one writer, which is the shape every bug found this week had: one rule, several writers, one of them out of step. **Fifteen things as of 2026-08-27** — the money and warehouse spines, plus what a customer said about the season, when they said it, how many feet of roofline they have, and the number on their bin.

⚠ It can tell whether a connection EXISTS, never whether it is RIGHT — except where a rule declares an exact broken shape that must not appear. And it only watches what has been declared: the page says how many things that is, and lists what it does NOT watch, so a green page is never read as "the app is fine".

---

## 10d. The path — Connections' front page

**Connections › The path.** Addie chose this over the grid as the front door: *"The path
becomes the page"*. It is a **graph you walk**, not a list you read — her own shape for it:
*"we push on quotes than approve and it will show the different routes in can go from there.
So we can figure out the different navigations by clicking on how things can go."*

It opens by asking **how the customer arrived** — a quote, typed in by hand, or the master
sheet — because opening on one door quietly claims everybody came through it. From there
every step offers what can happen next, and **the route you have walked stays on screen
behind you**, which is what makes two routes out of one step comparable: you can see how you
got here, back up one, and take the other. Clicking a step you have already passed truncates
the trail rather than adding to it.

⚠ **The grid is not replaced, it is put underneath.** Every step names the fields that record
it, and clicking one lands on that field's row on *Where things go* — the same one level in
it always was. What changed is that you arrive there through the journey.

⚠ **A step that is not built says so, and looks different.** The two payment chases are
Addie's own spec and neither runs today: a text at 30 days that the system tells the office
to send, and an automatic email at 60 days carrying a fee and a new invoice. The fee rule was
already written down in the page — **$25 if they have paid something, $40 if they have paid
nothing** — marked *preview only, not built*. Drawn as working, this page would be a wish
rather than a map, and its whole value is that it is true.

⚠ **`connections/journey.js` is hand-written, like the manifest, and for the same reason** —
the code can say what it does, never what order it was meant to happen in. What is checked
mechanically: every route points at a step that exists, every step is reachable by clicking
from some start, every step either leads somewhere or is marked an ending, and **every dated
step of the path appears** (read out of `queue-date.test.js`, so the two lists cannot drift).
`journey.test.js` also walks her two named routes and then clicks them through a real DOM,
because a correct graph behind a page that does not render is the failure this repo has
shipped before.

⚠ **AND THE LIST OF ROUTES CANNOT BE FINISHED BY A MACHINE.** A route nobody has drawn cannot
fail a check — invisible by construction, the same as an option we sell and never wrote down.
Addie caught the first gap by asking (*"you are currently adding all routes... Right?"*), and
the honest answer was no. Worse, **the gate was enforcing it**: it demanded exactly one start,
so a check written to protect the page was keeping it wrong. Reading the page and saying what
is missing is a permanent human job.

---

## 10e. Three places the code differed from her description of the path

Addie described the whole journey in one paragraph on 2026-08-29, checking her
understanding: *"it goes to quotes than we send an email they can choose to approve, deny,
back next year. If they push approve than they fill out the form after they fill out form
that goes back to us to convert to costumer than we convert to costumer, this then sends it
to costumer and there info to warehouse. Than onces there stuff is built we mark it complete
it goes to schedule, then it gets assigned out. After it gets assigned out and we hung the
lights there nighly invoice gets sent out. Than they either pay it or we sent out 2 other
messages asking them to pay. After they pay its over."*

**That is the shape of the business, and nothing in the app draws it.** Every step is in the
code and every step is now dated (§10c), but the ORDER lives only in that paragraph. The
Connections grid is one level deep by design — a field, and where it goes — and the customer
history (§10 above) is one customer's actual chain, not the chain. Her own words for the
limit: *"this can only show connection one level in."*

Checked against the code, her description is right except in three places. **None of these
is a bug; all three are worth knowing before anybody builds on the paragraph.**

1. **The form is for new customers only.** An existing member who approves a re-quote is
   asked *"do you want anything changed with your lights this year?"* and never sees the
   install-details form — they already have colours, wire and timer on file. `alreadyMember`
   in `quoteRespond` decides it, and it is deliberately wider than a phone match.
2. **The build now gates the schedule — it did not, and she asked for it.** *"I do want it
   to wait for the build before sending it to schedule."* `customersMissingFromSeason` asked
   `isOutForSeason` and the 48-hour lock and nothing about the build, so a crew could be sent
   to a house whose lights had not been made. ⚠ **The test is "still waiting"
   (`needsLightBuild === true`), never "has a built date"** — `lightsMarkedBuiltAt` only
   exists from 2026-08-27, so gating on it would hold back every customer on file before
   that, silently, which is the `SEASON_ELIGIBILITY` shape this file already records. ⚠ **Held
   back, not dropped**, like the 48-hour window beside it: they join on the next rebuild after
   the bundle is marked made, and nothing is written to the customer. ⚠ **And counted on
   screen** (`customersWaitingOnBuild`), because a house absent for a good reason looks exactly
   like one absent for a bad one.
3. **There is no automatic payment chasing.** Two things run on a schedule:
   `sendNightlyInvoices` (7 PM) and `sendQuoteNudges`, which chases an unanswered QUOTE, not
   an unpaid invoice. Chasing a bill is a manual send from Automation Emails with the Unpaid
   filter. So her *"we sent out 2 other messages"* happens because somebody sends them.

---

## 10c. When each thing happened to a customer

Seven of the ten steps a customer goes through leave a **date** on their record, which is
what makes a per-customer history possible: `createdAt` (quote raised),
`convertedToCustomerAt`, **`lightsQueuedAt` (sent to the warehouse)**,
`lightsMarkedBuiltAt`, `completedAt` (lights hung), `invoicedAt`, `paidAt`, and
`rsvpRespondedAt`. **`lightsRecycleRequestedAt`** (their old set asked for back), `removalDoneAt`, and — on the
invoice — **`newMemberFeeAppliedAt`**, the day the $30 join fee was charged.

Every step of the path a customer takes now carries a date, and `queue-date.test.js`
lists all nineteen so one cannot quietly lose its stamp: quote raised and sent, marked
approved, converted, sent to the warehouse, bundle built, needs a day, **put on a crew
sheet / fix route / takedown route**, **fix raised** and mended, lights up, takedown done,
old set asked back, RSVP answered, invoiced, paid, join fee charged.

⚠ **`scheduledDate` is the day they are booked FOR; `assignedCrewAt` is when the booking
was made.** That gap — between waiting for a day and being hung — is where a house sits
and gets forgotten, and until 2026-08-28 nothing measured it. ⚠ **`fixRaisedAt` survives
the mend**, beside `fixDoneAt`: the pair says how long the customer waited, and clearing
it would let the repair erase the wait.

Most of the money was already dated and that was checked before anything was built: the
$25 referral, manual discounts, carried credits, manual fees, the automatic $30 change fee
and the carryover charge each carry a `date` on their own note. The join fee was the one
fee with none, because it is folded straight into `install` rather than listed. What is
is an EDIT rather than a state — an address, a timer or a set of sides changing — and
those are now in the activity log rather than dated, because a date would say the address
moved on 3 October and never what it moved FROM, which is always the question. And
`scheduledDate` remains a different thing: the day they are booked FOR, not the day the
booking was made.

### Their history

**Edit Customer › Their history**, collapsed until you open it. One line per thing that has
happened to that house, newest first, from **five sources interleaved by date rather than
grouped by source** — grouped, the day something happened stops being the thing you read
down the page. The dated steps on the customer, the invoice's own dates, the quote that
started them, the payments ledger, and the activity log, which is the half that answers
*"changed the timer this date, changed the address this date"*.

⚠ **This is the reader the dates were waiting for.** Five of them — `lightsQueuedAt`,
`lightsRecycleRequestedAt`, `assignedCrewAt`, `fixRaisedAt`, `newMemberFeeAppliedAt` — were
written by real code and read by nothing, which the Connections map refused to declare
(R-010: written everywhere and read nowhere is a dead end). Their entries went on the grid
in the same change that gave them a reader.

⚠ **Something that happened with no date recorded is SHOWN as undated, under its own
heading** — never dropped, never sorted to one end. Dropped, the history quietly claims it
never happened; sorted, it invents an order somebody will act on. That is every customer on
file before the stamps shipped, so it is the common case rather than an edge one.

⚠ **Two fields are read off a record their name does not suggest**, both checked at the
write site: `convertedToCustomerAt` is on the **quote**, so reading it off the customer
loses the day they joined for everybody; and `carryoverChargeNotes` is on the **customer**,
because Start New Season zeroes the invoice and a charge parked there would be deleted
rather than carried.

⚠ **Collapsed, loaded on open, and reset on every open.** The panel runs two queries
(payments and activity), so it loads only when somebody actually wants the answer — and
`openEditCustomerModal` repoints this same form at a sibling house when a bill covers
several, so a panel left open would show the previous customer's history under the new
customer's name. The listener is bound **once**: that function runs on every house-tab
click, and re-binding is the accumulating-listener bug that put 2815 writes behind one drag
in the Inbox.

⚠ **The quote it reads is the one that CONVERTED them**, not any quote pointing at them —
every re-quote points at the same record, so a plain lookup would show a re-quote raised
last week as the day they joined.

⚠ **`history.test.js` censuses its step list against `queue-date.test.js`'s own**, each read
out of the other rather than both typed. A new dated step cannot be added without reaching
this page, or being named as deliberately absent with the reason. `paidAt` is the one named
absence: payments are their own ledger with several rows per invoice, so they come from the
payments collection rather than a single date.

⚠ **AND IT IS PER CUSTOMER, NOT THE PATH ITSELF.** Addie, 2026-08-29, on the Connections
grid: *"this can only show connection one level in"* — and she is right about this page too.
It shows what happened to Jane Smith. The SHAPE of the journey — quote, email, they approve,
they fill the form, we convert, warehouse, schedule, crew, invoice, paid — exists in the
code and in her own description of it, and is drawn nowhere. See §10d.

### The change log

Saving Edit Customer diffs what it is about to write against what the record held and
writes ONE activity entry naming every field that moved — *"Edited Ashley Wray — Timer:
off → on; House price: $400.00 → $450.00"*. One entry per save, because a save is one
event; a row per field turns an afternoon of tidying into a wall nobody scrolls. Past
twelve fields it says how many are not shown rather than quietly ending.

⚠ **Every editable field is either labelled or deliberately quiet, and
`change-log.test.js` holds the census.** A field with no label does not throw and does not
warn — it simply never appears in anybody's history, which reads exactly like the field
never being edited. So a new field that is neither fails the build, and a quiet one must
carry the reason it is quiet: *quiet* and *forgotten* look identical in a list of names,
and the census cannot tell them apart either. Quiet covers the stamps (the build line is
the event; `lightsQueuedAt` is its date) and `lat`/`lng`, which move only because the
address did.

⚠ **The vague entry that used to sit there is gone, not left beside the new one.** It read
"Edited customer Ashley Wray" and nothing else, on every save including ones that changed
nothing — filling the log with rows that could not answer the only question anybody asks
it.

⚠ **Two faults in it were found by RUNNING the diff, not reading it**, and both would have
made the log unreadable rather than wrong. An unticked box reaches the save as `''` while
the record stores `false` — the same answer spelt two ways — so every save of every
customer reported a row of tick boxes changing. And a record predating a field does not
carry it, so the first save after one was added reported the form's own defaults
(*"Referrals: (blank) → 0"*) as though somebody had typed them: six such lines out of nine
on a save that changed one thing. A field the record never held, arriving empty, is not an
edit; a stored value being cleared still is.

`lightsQueuedAt` was added 2026-08-28, after Addie asked "what about when bundle got sent
to warehouse". Until then the record knew when a bundle was MADE and not when it was ASKED
FOR — so "built on 14 Oct" could not tell you whether it waited two days or five weeks, and
a house queued and forgotten looked exactly like one queued that morning.

⚠ **It is stamped on the transition, never on every write.** Two places write the build
flag on EVERY save, keeping whatever it already held — the house-details panel and the Edit
Customer save. Stamping there each time would reset the clock whenever anybody opened a
record to fix a phone number, which destroys the only thing the date is for. ⚠ **A
re-queue is deliberately a new date**: the warehouse is waiting on the newest request. ⚠ And
it is **not cleared when the build is marked done** — "queued on the 2nd, built on the 9th"
is the point.

⚠ **In the Edit Customer save the stamp goes LAST, after every branch that can move the
flag.** Five of them do: the colours ternary, a changed wire or timer, a rejoin after a
recycle, the re-quote answer, and the Maybe Next Year block, which CLEARS the build. The
first version sat inside the re-quote branch, so a save that queued a build any other way
— a changed wire most of all — recorded no date at all. Nothing in the census saw it: a
census asks whether the function CONTAINS a stamp, never whether every path reaches one.
It surfaced only because a test sandbox lifts that branch and died on a name it had never
been given.

⚠ **Fifteen places queue a build**, across the office and the portal, and
`queue-date.test.js` keeps a census of all of them: a new one that does not stamp fails the
build. `stampBuildQueued` in admin.html and `stampBuildQueuedServer` in functions/index.js
are the two copies of the rule — change one, change the other, in the same push.

---

## 11. If X isn't working, check Y

- **A route/customer list is empty with no error** → check `firestore.rules` first for that collection. A collection missing a rules entry is denied by default and fails *silently* in a listener (no console error a non-coder would notice).
- **A field the portal should show is blank or stuck at 0** → check whether that field is in the relevant Cloud Function's *read whitelist* (`PORTAL_READ_FIELDS`, `INVOICE_READ_FIELDS`, `QUOTE_READ_FIELDS` in `functions/index.js`). The portal only ever sees a function's sanitized output, never the raw document — a field can be correctly written and still invisible to the customer if it's not on that list.
- **An invoice's balance/status looks wrong** → check whether `changeFees` is actually being included in that particular screen's math. This was the P0 bug for this pass; the formula is documented in §3 so any *new* code touching balances can be checked against it.
- **A route change (address, gate code, name) isn't reaching the crew** → check whether the route is *upcoming* — both resync paths deliberately skip past/history routes. Also remember only `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber` are ever frozen into a stop; other fields are supposed to be looked up live, so if one of *those* isn't updating, the live-lookup code itself is the place to check, not the resync.
- **Firestore is throwing `failed-precondition`** → almost always a missing composite index. The index (or rules) file being correct in the repo means nothing until `firebase deploy --only firestore:indexes` (or `:rules`) actually runs — Netlify never touches Firebase, and a correct file sitting undeployed looks identical to a wrong one from the app's point of view.
- **A customer's bin/number logic looks off at exactly 200 ft** → the actual cutoff in code is 260 ft, not 200 (see §2). Check `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js (they moved out of admin.html) before assuming a bug.
- **A big house shows fewer bins than it needs** → check whether the code doing the deciding tests `numberOfBins === 2`. Bins go up in 260s now, so a 900 ft house is 4 bins; `=== 2` reads that as "not a double" and hands it a regular customer number.
- **The same System notice arrives twice, word for word, minutes apart** → treat it as a sweep loop, not as noise. A sweep doing real work finds *less* to do next pass; a byte-for-byte identical notice (same counts, same names in every list) is the signature of one pass undoing another. Check that eviction and the cap/top-up are asking the same question about the same day — `routeDayTowns` is the single answer, and `stopProblem` and `evenOutDays`/`fillDays` must all read it (§5).
- **A button on a generated page does nothing at all, with no error** → look at what is being written into the button, not at the handler. On 2026-08-27 not one of the 181 blocks in the Rules view would open, because a rule name Addie wrote carries a double quote (`Is a pooled number somebody still holds "available"?`) and it was being pasted straight into the button's hidden label — the quote ends the label early, the button hands back a chopped-off name, the lookup finds nothing and the click quietly does nothing. Anything taken from `claude/questions-map.md`, from `connections/manifest.js`, or from a customer record is prose somebody typed, so it must be escaped at every point it is written into the page — and never at the source, because the real text is what every lookup is keyed on.
- **A crew-day appears for a town nobody recognises** → look at that customer's `city` field on the record, not at the scheduler. `extractCleanCity` only strips zips and `UT`/`Utah` and drops any part containing a digit, so a *street* typed into the town field (`S Summit Crest Ln`) survives cleaning and reads as a town — and the builder then gives that invented town a crew-day of its own. This is a data fix on the record; nothing in the sweep will clear it.
- **Firestore's "Fetch failed" / long-poll `Listen`/`channel` message in the console** → normal reconnection noise, not a bug.
