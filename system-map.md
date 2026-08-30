# Highlighting Utah — System Map

Written for Addie (non-coder) by Claude Code from a full read-through of the real code. This explains how the app actually works today, not how it used to work — where this disagrees with old notes or your own memory of a feature, trust this document and flag it if something seems off.

**Kept current with every change, not regenerated occasionally** (Addie, 2026-08-26: "system map should be every time"). First written 2026-08-08; last brought up to date **2026-08-26**. ⚠ It is UPDATED rather than rewritten from scratch — a wholesale regenerate loses the hard-won detail in it and risks introducing errors into the one document written to be trusted. If a section here contradicts the code, the code is right and this is a bug in the map.

---

## 1. The lifecycle, start to finish

1. **Public quote** — a visitor fills out the quote form on the public site. It's saved to `quotes` with `status: 'new'`. No photo is attached automatically anymore (see §9).
2. **Office prices it, then sends it** — a staff member opens the quote card in Admin, fills in estimated feet and a quoted price, and sends it one of two ways. Both save a `quoteToken`, and that token is the whole of how the customer is later recognised.
   - **Send quote email** (the gold button) saves `quotedPrice` and the token, then emails the long link, `https://highlightingutah.com/#/quote-details?token=...`.
   - **Send as text instead** sends the short one, `highlightingutah.com/q/<token>` — the same page by a different address, about 40 characters shorter, which is what keeps a quote text inside one billed message. Netlify rewrites `/q/*` to the app and the app turns the path back into the same route the long link uses, so both spellings work for ever and every quote ever created already works at both.
   - ⚠ **A quote reaches the text button without ever having been emailed**, so the text path mints the token itself (`ensureQuoteToken`) rather than assuming the email path already did. It did assume that until 2026-08-30, and the result was a link ending in a bare `/q/` — well-formed, accepted by the phone, and refused by the router, so the customer landed on the homepage instead of the quote and the office was told the text had sent, because it had. If the token cannot be saved, nothing is sent at all.
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

**Hold the right button to look around, and to move the sky view.** While you
are measuring, a left drag places and drags dots and the sheet covers the whole
picture — so there was no way to look anywhere else without coming out of
measuring first. The right button does it instead, on all three pictures
including the grade screen. Street View **follows your mouse**: drag right, look
right; drag down, look down — the way Roblox Studio does it, which is the
opposite of Google's own left drag. The sky view **grabs the world**, so what is
under the pointer stays under it, exactly as its own left drag behaves.

⚠ **It turns at exactly the speed of your hand.** That is not the obvious sum:
spreading the field of view evenly across the width of the picture under-turns
by about a fifth, because a perspective picture gives the middle of the frame
more angle per pixel than the edges. It uses the camera's own focal length
instead — the same one that decides where a mark is drawn — so a drag near the
edge turns slightly less than the same drag through the middle, which is what a
real camera does. Zoomed in it turns less, because the picture is magnified.

⭐ **And it follows your hand, not the cursor.** Windows has *Enhance pointer
precision* switched on for this machine, which is mouse acceleration: the cursor
is not a fixed multiple of your hand, it travels proportionally **less** on a
slow drag and more on a fast one. Driving the camera from the cursor inherited
that, and measuring a roof is exactly the slow careful drag where it under-runs —
so the picture kept falling behind. No multiplier fixes it, because the error
depends on how fast you happen to be moving.

While you hold the right button on a picture the pointer is **locked** and the
raw mouse movement is read instead, the way a game does it — Windows sensitivity
and acceleration are both bypassed. The cursor disappears for the duration and
comes back exactly where it was, and the drag no longer stops at the edge of the
screen. `RM_LOOK_SENSITIVITY` is the dial if the rate ever needs adjusting to
taste. If a browser refuses the lock, the drag still works off the cursor as
before — worse on a slow movement, but never broken.

⭐ **How fast it turns is yours to set — Look speed, under More options.** It
starts at 2.5× your hand and is saved on that computer only, never synced: a
comfortable look speed belongs to a person and a mouse, not to the business, and
pushing one desk's setting onto every other would be worse than no setting at
all. Tracking the hand exactly (1.0) is the honest baseline, but it is slower
than any game feels — which is why the default is well above it.

⚠ **The sky view is deliberately not locked.** There you are grabbing a real
point on a map and want the real cursor; hiding the pointer to pan would be both
disorienting and wrong about what is being dragged.

⚠ **The right-click menu still works — unless you held and dragged.** A plain
click on a picture opens it as usual; only a drag takes it away, and only that
one time. A few pixels of hand jitter still counts as a click.

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


**Every control is at the top, in its own bar; the pictures are last.** Attach
to Quote and Close ride above the heading row, then the capture buttons, the
tools, the Save block and Roof Facts — and nothing below the pictures is a
button any more. ⚠ This reverses the earlier arrangement that put the pictures in
the MIDDLE, and the reason that one existed still matters: the pictures twice
fell through to an unnumbered catch-all and ended up below everything, off the
screen. Every row is now numbered by hand and the pictures carry the highest
number, so a row somebody adds later lands above them rather than under them.

⚠ Two of those rows are hoisted by CSS rather than moved in the page: the capture
bar sits inside the picture area in the markup, and the Attach row is a child of
the card. `display:contents` and a negative order lift them without cutting any
markup — which is why this was safe to do without disturbing the measuring code.

⚠ **The height budget had to be re-cut when they moved.** Six fixed rows above the
pictures came to 488px of a 666px card, and the map was left **39 pixels tall** on
the live page. Three things had been sized for the old arrangement, where the
toolbar was the only thing above the house: the toolbar's fixed height (now 118),
Roof Facts (capped and scrolled — it is reference rather than a control, but it is
where Google's own footage appears, so it is not hidden), and the pictures' floor
(now 190). **A floor that does not fit is its own bug** — it pushes the pictures
off the bottom instead of shrinking them, which is precisely what happened.

The pictures are the one row that **grows**, so every pixel the ribbon does not use
goes to the house.

⚠ **And making the wrapper `display:contents` promoted ALL of its children**, one
of which carries no id or class — so it defaulted to the catch-all order and
jumped 25px to the very top of the tool. That is the same failure the numbering
exists to prevent, caused by the fix for it. Every child of that wrapper is
numbered now, not just the pictures.

⚠ **And the row holding it all had to be allowed to shrink.** It could grow but
not shrink, so it could never settle back down to its own minimum — the pictures
grew to fill a stage taller than the card and hung off the bottom, 770 of content
in a 666 card. The floor is what stops rows painting over each other; being able
to *reach* that floor is what makes everything fit.

⚠ **And the floor itself had to move onto the pictures.** Putting it on the whole
stage (`min-content`) stopped the overflow, but that value computes *larger* than
the rows it is made of — so the stage could never come down and the pictures hung
off the bottom anyway. The pictures carry a real pixel floor now and every other
row up there is a fixed height, so the pictures shrink to that floor and no
further, nothing collapses to nothing, and the card scrolls only if even that
will not fit. Measured with every row present: no scrolling, both pictures whole.

⚠ **In the end the picture height is worked out from the window, not negotiated.**
Three deploys were spent trimming rows on the belief that the pictures would
shrink into whatever was left over — they never did, and the card went on
scrolling. Everything above the pictures is a known fixed height, so the pictures
simply take what is left of the window after it. **The cost of that is a number
that has to be kept in step:** add a row to the ribbon, or change one's height,
and the subtraction in `.rm-panes` has to change with it.

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

⚠ **A NO TO A PRICE IS NOT A NO TO THE SEASON**, and the graph said otherwise until
2026-08-29 — `declined` was drawn as an ending. It is not one: `declineAsksAboutLastYear`
marks the customer's changes settled and asks whether they want the same as last year, and
they keep their route, their build and their place. Turning down an **add-on** is a third
thing again, and the code's own comment records that it leaves no other trace anywhere.

⚠ **Three more states the app can really be in, drawn the same day**: colours changed AFTER
the crew already has the card (`lightsChangedAfterAssign` — their sheet is printed and the
pattern is wrong); a house finished with **no email anywhere on the bill**, flagged and
skipped by the nightly run until somebody adds an address; and a captured payment that finds
no bill at all. All three were already dated in the code and simply not on the page.

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

### Archiving a quote is one fact in three fields

Declining from the quote email sets `quoteArchived`, `quoteArchivedReason` and
`quoteArchivedAt`. Approving or choosing *maybe next year* un-archives — and until
2026-08-29 it cleared the flag and the reason and **left the date standing**. A restored
quote read as archived on a date AND not archived at the same time: two fields describing one
state and disagreeing, so anything reading the date to decide how long a quote had been
closed got an answer about an archiving that was undone.

⚠ **Two of the three were cleared, which is why it went unnoticed** — two out of three looks
complete. Nothing anywhere looked at them together, and each on its own is written correctly.
The bug is only visible in the relationship.

⚠ **AND THE FIRST CHECK WRITTEN FOR IT PROVED NOTHING.** It grouped by enclosing function,
and both branches live in one function — so deleting the date from the restore branch left it
written in the archive branch, the function still "touched all three", and two red-check
sabotages went straight through. It is scoped to the branch now. A check that looks right and
cannot fail is worse than no check, and this is that trap caught in the act.

### The colour change she asked for first, and the history that did not show it

Addie's list of what she wanted dated opened with *"asked for different lights on this
date"*. `lightsChangedAt` had existed for a while — written by the portal, by Edit
Customer and by the sheet sync, read by the Color Changes tab and the warehouse badge —
and it was **on no path and in no history**. So the event she named first was the one
missing from the page built to answer her, and nothing anywhere was red about it.

⚠ **A field written everywhere and named on no route is the shape of hole the two censuses
exist to catch**, and neither could see it: `queue-date.test.js` checks that every field on
`PATH_STEPS` is written and dated, `history.test.js` checks that every field on `PATH_STEPS`
reaches the history, and a field that was never on the list satisfies both by being absent.
It is on the list now, so both hold it.

⚠ **The history says WHO changed it.** `lightsChangedVia` exists precisely because the
customer changing their own colours and the office typing it in after a call are the same
event from opposite ends — the warehouse badge already tells them apart, and the history
must not be the one screen that flattens them. `historyLightsWords` gives the same three
answers from the same field, and deliberately does **not** call `whBuildReasonKey`: that
answers a different question (why a bundle is being built, where a re-quote outranks a
colour change), so a house that moved *and* changed colours would come back "rebuild" and
the line would say nothing about the colours at all.

⚠ **An unrecorded origin claims neither.** Every colour change made before 2026-08-24
carries no `lightsChangedVia`, and assigning one of the two on a coin toss prints a
confidently wrong claim beside a real date — worse than an honest silence, and the rule the
badge already keeps.

⚠ **It is its own line, not the build-queue line.** A colour change queues a build, so the
two sit together on a real record and it is tempting to read one as the other — but a build
is also queued by joining, by a re-quote, by a wire change and by coming back after a
recycle, and only one of those is somebody picking different colours.

⚠ **And two boxes on the path, not one.** The page had only `changedafter` — a change made
*after* a crew is holding a printed card, which is a genuine emergency. Drawing only that
one makes every ordinary change look like an emergency and hides the fee question entirely:
inside their 48-hour window a change is free, outside it is $30. `colourchange` now reaches
both the warehouse **and** the bill, from two places — being asked what is changing, and
changing your mind while waiting for a day. Both routes are walked by name in
`journey.test.js`, because a reachability check alone stays green with either one deleted.

### A finished takedown resets with the season

Addie, 2026-08-29, asked directly: *"Oh so if we removed lights from someone's house that
should reset for new season."*

⚠ **It was the one job-done flag left standing.** Start New Season clears `completed`,
`invoiceEmailSent`, `scheduled`, `scheduledDate`, `assignedCrew`, `chargeNewMemberFee`,
`needsDayAssignedAt`, `rejoinedForSeasonAt` and `cameBackThisSeasonAt` — and did not clear
`removalDone`. Nothing else in the app ever did either: the only other writer of
`removalDone: false` is the Mark Done toggle being unticked by hand. So a customer whose
lights came down last December read **Removed** all the way through the new season, until
somebody visited the record.

⚠ **Same shape as `completed`, which is why it belongs beside it.** Both say a job was
finished *this* season, and neither is true of the season about to start.

⚠ **The date stays.** `removalDoneAt` is untouched, like every other date in that write —
the history needs it to say when last season's takedown happened, and `seasonResetAt` is
the line that stops it reading as this season's. **Clearing the flag and keeping the date
is the whole design**, and the tempting "tidy" fix that nulled both would throw away the
only record the work ever happened. Asserted in both directions.

⚠ **In the same write as the rest of the reset**, and checked. Start New Season rewrites
every customer in one press and cannot be undone; a separate write can fail on its own and
leave half the book reset.

### Three steps that looked dateless and were not

Three boxes on the journey page carried no dates at all, and each was hiding a real one.
**The census could not see it**: it only asks that every field on the dated path is drawn
*somewhere*, so a field already drawn on one step is not missed when a second step that
also carries it names nothing.

⚠ **The two starts are the point.** Somebody typed in by the office, or brought in by the
master sheet, has no quote-raised day and no approval day — `createdAt` is the only date
they have. Until the joining row was added, the history read that field off the **quote**
alone, so the moment those customers came into existence was invisible for most of the
book.

⚠ **And a decline is dated exactly like an approval.** `quoteRespond` stamps
`approvalRespondedAt` alongside the status **before** it branches on the action, so a no
carries it as surely as a yes does. Drawn bare, the page read as though only a yes is ever
recorded — and *"did they actually reply, or did we take somebody's word for it"* is the
question behind every argument about a quote, on a no more than on a yes.

### Two rows for one colour change, on purpose

Editing colours produces **two** lines on a customer's history, and it is worth saying why
rather than leaving somebody to find it and tidy one away:

- the **step** — *"Asked for different lights — they changed them in their own portal"* —
  answers **when**, as a stage of the journey, and **who**;
- the **log row** — *"Light colours: Warm White → Red, Green"* — answers **what it changed
  from**, which a date cannot carry.

That split is the whole design of the change log, in its own words: *"a date can say the
address moved on 3 October and never what it moved FROM"*. They are two mechanisms
answering two questions about one event, and dropping either loses the half the other
cannot say. `CUSTOMER_FIELD_QUIET` already suppresses `lightsChangedAt` **as a field edit**
so the date itself is not logged twice.

⚠ **If it reads as noise on a real record, take the log row, not the step** — the step is
what the journey page and the path both draw, and the office's from→to survives in the
activity log either way.

### Checked and closed: the portal read whitelist

CLAUDE.md names a silent-blank class — *"a field the client reads must be in that
function's read whitelist or the customer never sees it"* — so every field `index.html`
reads off a portal record was swept against `PORTAL_READ_FIELDS`. **Nothing is missing.**

⚠ **Eleven looked missing and all eleven are fine**, which is why this is recorded rather
than left for somebody to run again. Nine are read off a variable called `record` that is
reused for the **invoice** document, which has its own whitelist (`INVOICE_READ_FIELDS`).
`lightChangeFreeUntil` is set by `portalInvoice`, not `portalLookup`, and
`currentLookupRecord` — despite the name — is filled from the invoice call.
`addrDoc.portalToken` is assigned by the browser from the response's `token`, not read off
the record at all.

⚠ **And it is deliberately not a gate.** Disambiguating which document a variable named
`record` holds is exactly the leaky attribution that was abandoned for the by-document
check above, and for the same reason: a gate that cries wolf on correct code is one
somebody switches off.

### A step that reads the wrong document is silently dead

Each history step names the document its field comes from — `cust`, `quote` or `inv`. If
that is wrong the step is **silently dead**: `customerHistory` looks the field up on a
record that never carries it, finds nothing, and skips. No throw, no warning, no row, for
everybody.

⚠ **The other two censuses are blind to it by construction.** `queue-date.test.js` proves
the field is *written* with a real time somewhere; `history.test.js` proves the field is *on*
the step list. Both are perfectly satisfied by a step pointed at the wrong document — the
field really is written, and it really is listed. Only the `from` is wrong, and nothing
looked at it.

⚠ **It happened twice in one day, and the second one was mine.** `createdAt` was read off
the quote alone, so most of the book had no joining row. Then `formCompletedAt` was added
reading off the **customer** when both of its writers put it on the **quote** — the portal's
own form writes it there, and `quoteSaveDetails` writes it there for somebody following an
emailed link. It could never have fired for anybody, and every check in the repo passed.

⚠ **Working out the home from the source was tried and abandoned.** The writes take five
different shapes across two files, and the best attribution still produced six false
mismatches and four unknowns. A gate that cries wolf on correct code is one somebody
switches off.

⚠ **And a behavioural check alone could not do it either** — proved by red-check, not
assumed. Populating one document at a time and counting rows misses a field *moved between*
two documents, because the fixture is built **from the declaration under test**, so any
assignment is self-consistent. That is the trap this repo keeps meeting.

⚠ **So the test states it independently** — a frozen `FIELD_HOME`, exactly the argument
`options-audit.test.js` already makes for its `AGREED` map. It is a second copy and is meant
to be: its whole value is being written from the **write sites** rather than from the step
list, so the two can disagree. Each entry was checked at its writer, not inferred from its
name — `formCompletedAt` reads like a customer field, which is precisely how it shipped
wrong. **If you add a step, open the writer.**

### The day they joined, for everybody who never had a quote

`HISTORY_STEPS` read `createdAt` off the **quote**, so it answered nothing for a customer
who arrived any other way — typed in by the office, or imported from the master sheet, which
is most of the book. Their history simply began at whatever happened to them first, with no
row anywhere saying when they became a customer.

⚠ **The path census could not have caught this one either**, and the reason is worth
noticing because it is a *third* shape: `createdAt` was already on `PATH_STEPS`, so every
list was satisfied — the field is written, the field reaches the history — while the row was
missing for almost everybody, because it is read from the wrong **document**. It takes
running the history against a customer who has no quote at all.

⚠ **A quote customer gets both rows**, which is right rather than duplication: the day
somebody asked for a price and the day they became a customer are different days, often
weeks apart, and the gap between them is a real thing to look at.

⚠ **All six creators do set the field** — checked one at a time. The field was never the
problem; nothing read it. A census now freezes that, and it is written against **the object
that is actually written**, not the function around it: a first version searched the whole
enclosing handler and the red-check proved it could not fail, because those handlers write
several collections and a `createdAt:` belonging to something else satisfied the search.

⚠ **And a scan that looked inside the `addDoc` call answered the original question
wrongly.** Four of the six build their object in a variable above the call and pass it by
name, so a scan of the call's own parentheses reported them as missing the field when every
one of them sets it — *"three of six never set it"* was a confidently wrong answer that sent
a whole line of work in the wrong direction until it was checked one at a time by hand. The
census reads both shapes now, and says *"could not read the object"* as itself rather than
reporting it as a missing field: the two need different fixes and only one is about the app.

### A waived $30 fee left no trace at all

`lightFeeWaived` is a **local variable** in the Edit Customer save. It decides whether the
$30 light-change fee is charged and then goes out of scope: nothing is written, no field
moves, and the only thing that ever said it happened was a toast — which is gone the moment
somebody looks away.

⚠ **The asymmetry is the fault**, and it is the same shape as everything else found today.
A fee that **is** charged lands on the invoice as a `changeFeeNotes` entry with its own
amount, reason and date, and `historyNoteRows` reads it straight onto the customer's
history. A fee that is **waived** produced nothing anywhere — so *"why was this customer not
charged for changing their colours"* had no answer, and the record was indistinguishable
from one where nobody was ever asked.

⚠ **The log, not a field.** This is an act somebody performed, not a state the customer is
in. A `feeWaived: true` on the record would be read back by something eventually and would
then have to be cleared, and there is no correct moment to clear it.

⚠ **Its own row, not folded into the edit sentence.** That sentence lists what *changed* and
is capped at twelve fields; a waiver is precisely a thing that did **not** change, so folded
in it would be the first line dropped by the cap and the last one anybody would look for.

⚠ **Guarded on both the flag and the amount.** `lightFeeWaived` starts false and stays false
when there was no fee to waive at all, so the flag alone would eventually log a waiver on an
ordinary save — and a log with invented rows in it is one nobody trusts.

### What a customer changed in their own portal

Addie's list ended *"or changed timer settings this date. Changed address this date."* Both
are **edits** rather than stages, and the answer to an edit is a log line rather than a
stamp — *"Address changed on 3 Oct"* is a worse answer than none, because the question is
always what it changed **from**. `describeCustomerChanges` does exactly that for the office.

⚠ **And it did nothing at all for the customer.** The activity log is written only from
`admin.html`, so a timer switched on in Edit Customer produced *"Timer: no → yes"* and the
same switch flicked by the customer in their own portal produced **nothing** — not a stamp,
not a line. The office half looked complete, which is why nobody noticed the other half was
missing. Exactly the asymmetry `lightsChangedVia` exists to close one level up, in a new
place.

⚠ **Two copies, so a parity test** — the same answer this repo gives the invoice maths, and
for the same reason: a browser ES module and a Node function cannot share code. What keeps
it small is the **scope**: the portal can only ever write `PORTAL_WRITE_FIELDS`, so
`PORTAL_CHANGE_LABELS` is deliberately that set and no more, and `change-log.test.js` runs
both copies over every one of them in six shapes and fails the moment they disagree about a
sentence. It asserts they are **right** as well as equal — two copies wrong in the same way
agree perfectly.

⚠ **The diff is taken before the write and posted after it.** Taken afterwards it compares
the new record with itself and reports nothing ever changing; posted before, a line about a
save that then failed is the log claiming something happened that did not.

⚠ **It says it was them.** Every other row in that log is one of the four people who share
the dashboard, so a portal edit worded like an office one would be the log actively
answering *"who changed this"* wrongly.

⚠ **It cannot break the save.** `logPortalChange` swallows its own failure — this runs on a
path that also queues builds and charges a $30 fee, and a note about a change is worth less
than the change. `firestore.rules` needs no edit: the function writes with the Admin SDK,
and the history reads the log from a signed-in dashboard.

⚠ **One of this section's own checks was vacuous and the red-check caught it**, for a
reason worth writing down: `hasOwnProperty` is **true** for a key explicitly set to
`undefined`, so every fixture written as `{f: undefined}` sails past the never-held guard
without reaching it — and for a yes/no field both sides render `no` either way, so the
earlier equality return fires first and the guard is never consulted at all. Deleting it
entirely left the whole section green. It takes a field genuinely absent and a value that
renders as an empty text but not as `(blank)` — a zero — to reach it.

### Every date the code writes is on a path, or is said not to be

The colour change above was found **by hand**, one field at a time, and only because
somebody happened to re-read Addie's list. So the obvious next question was how many more
there were. Sweeping every field in the four source files that is written with a **real
timestamp** — a server sentinel, a `Timestamp`, a `new Date`, or the `ts` a shared rule is
handed — turned up **thirty-five more on no path at all**, and **twelve of them were plain
stages of a customer's journey whose field was already being written**. Two were Addie's own
words a second and third time: *"or maybe next year date"*, *"or requoted on"*.

⚠ **Neither existing census could have found them, and that is the finding.**
`queue-date.test.js` proves every field **on** `PATH_STEPS` is written and dated;
`history.test.js` proves every field **on** `PATH_STEPS` reaches the history. Both are
perfectly satisfied by a field that was never put on the list — it is *absent from the
question*, not answered wrongly. So the sweep has to start from the **code** and work back
to the list, which is the opposite direction from everything else in that file.

⚠ **The pairs are what was really missing**, and each one is a question somebody actually
asks:

| the easy half | the half that was missing | the question it answers |
|---|---|---|
| `approvalRespondedAt` | `quoteRespondedAt` | did they reply, or did we take somebody's word for it |
| `invoicedAt` | `invoiceEmailSentAt` | was a bill raised, or did it actually go out |
| `lightsRecycleRequestedAt` | `lightsRecycledAt` | asked back, or actually back on the shelf |
| `requotedAt` | `requoteAppliedAt` | when the price changed, or when they agreed to it |

Flattened into one row each, the history answers the easy half **and looks complete doing
it** — which is worse than showing nothing, because somebody acts on it.

⚠ **`requotedAt` could not be a step at all**, and that is why it needed its own mechanism.
It lives on the **quote**, and a re-quote is a separate quote document — the history reads
only the quote that *converted* them, deliberately, so a re-quote raised last week does not
read as the day they joined. A step keyed on it would have looked right in the list and
found nothing for almost everybody. `historyRequoteRows` gives **a row per re-quote**,
because three re-quotes in a season is a house nobody has measured properly and a single
"last re-quoted on" hides exactly that — each naming its kind, since an addition, a move and
a corrected price are three very different amounts of work.

⚠ **"Not a journey date" is a legitimate answer and most of them are** — a clock-in, an
export, the nightly run's own last-run marker. What is not legitimate is *silence*. All
twenty-seven now carry their reason in `NOT_A_JOURNEY_DATE`, and a new dated field fails the
build until somebody decides which it is. **That is the whole difference between this and
the sweep that found them**: the sweep was a thing somebody thought to run once.

⚠ **And the excuse list cannot go stale either.** A field that stops being written must
leave it, or it silently excuses a name that no longer exists — and the next real field with
a similar name inherits the excuse.

⚠ **All three lists agree now, with no standing notes.** Both censuses used to end in a
"the page names N fields the path does not" note, and those notes had been true and ignored
for weeks. **A note is not a gate.** The seven strangers are on the path; the two that
genuinely are not stages carry reasons; and the strangers check now only considers fields
that are dates, so a step naming `requoteKind` no longer fires a note for ever — which costs
the real notes their audience.

### A merge says what it took, and from where

Merging duplicates writes another record's values onto the keeper and then **deletes that
record**. Until 2026-08-29 nothing said which record, or when, or what was taken — so *"why
does this customer have an address they never gave us"* had no answer anywhere. The activity
log records a count with an empty id, so even that cannot name them.

⚠ **This is the one event on a record that was previously unrecoverable.** Everything else on
the keeper can still be read; the spare is gone the moment the delete runs, so if its id is
not written down at the merge it cannot be recovered by anybody. `mergedAt`, `mergedFromIds`
and `mergedFields` now ride **in the same write as the gains** — a second write can fail on
its own and leave a record carrying another's values with nothing saying so, which is worse
than the state being fixed because it looks clean.

⚠ **THREE PLACES ABSORB A RECORD, AND THE COMMON ONE WAS MISSED FIRST.** `mergeFieldsFrom`
is the shared rule for taking another record's values, and the Danger Zone merge is the one
that got the trace on the first pass — while the **sheet sync's fold-in does the same thing
on the path that actually runs often**. The Danger Zone tools are used rarely and
deliberately; folding in a spare copy happens on an ordinary sync. `queue-date.test.js` now
censuses every caller, so the rare path cannot be fixed while the common one is missed —
which is exactly what happened. Two callers only *scan* (building the preview of what a merge
would gain) and are named as such, verified rather than assumed: neither body contains a
write of any kind.

⚠ **Only when something was actually taken.** A merge that gained nothing is a spare empty
copy being tidied away; stamping it would claim this record was built out of another when it
was not.

⚠ **AND A FOURTH TOOL DELETES WITHOUT TAKING ANYTHING AT ALL, which the census above could
not see.** Danger Zone → **Duplicate customers** refuses any group where a copy holds
something the keeper does not — that superset rule is the whole reason it is safe to delete
rather than merge — so it never calls `mergeFieldsFrom`, and a census over that function was
blind to it by construction. It left no trace anywhere. It now writes `mergedFromIds` with
the ids that **actually went** and `mergedFields: []`, which is the honest answer rather than
a missing key: `historyMergeWords` prints the bare *"Merged with a duplicate record"* for an
empty list and appends *"— took …"* for a full one, so the two tools read differently on the
history without either of them lying.

⚠ **So the census is over the DELETE now, not over the merge.** Deleting a `jobAddresses`
document is the irreversible act; whether values moved first is a detail of how. All five
sites are named in `queue-date.test.js` with what happens to the memory of that record, and a
sixth fails the build until somebody decides. **"Nothing to trace" is a legitimate answer said
out loud** — Delete All Customers empties the book, so there is no keeper left to write onto,
and `hlxRemoveCustomerToRecycle` copies the whole record into `archivedCustomers` first, so
nothing is lost to trace.

⚠ **AND THE FIRST RED-CHECK PASS MISSED THE ONE THAT MATTERED.** Wrapping the whole trace
write in `if(false)` left every string exactly where it was and all three checks stayed green
over a write that could never run — this repo's oldest recurring fault, *"a message that is in
the source is not a message on the screen"*. The guard is now asserted as **the collected list
of ids**, which is both the reachability proof and the only-write-when-something-went rule in
one line.

⚠ **The history names the fields**, not just the event — *"took address, housePrice,
gateCode"*. "Merged with a duplicate" beside a date leaves the actual question, which of these
fields is not theirs, exactly where it was.

### Where one season ends and the next begins

Start New Season clears the **flags** and keeps every **date** — `completedAt`,
`lightsQueuedAt`, `lightsMarkedBuiltAt`, `assignedCrewAt`, `removalDoneAt`, the fix pair.
That is right: wiping them would throw away the only record any of it happened, and *"queued
on the 2nd, built on the 9th"* is the whole point of having them. What was missing was a
**line between the seasons**, so a record carried last year's dates beside this year's flags
and the customer history ran the two together — last October's install reading exactly like
this October's.

The reset now also stamps **`seasonResetAt`**, and the history draws it as a divider:
*"— New season started. Everything below here is last season —"*. Newest-first, everything
under that row belongs to the year before.

⚠ **It is a marker, not a clear**, and it is the only thing added to that write. Nothing
existing reads it, so it changes no behaviour.

⚠ **`removalDone` is NOT cleared by the reset, and nothing else clears it either** — the only
writer of `removalDone: false` is the Mark Done toggle being un-ticked by hand. So a customer
whose lights came down last December reads *Removed* all through the new season. `completed`
and `removalDone` are the same shape of fact and the comment on that write explains why each
of the other eight fields is cleared; this one is not mentioned, which makes it look like an
oversight. It is **Q-026** rather than a fix: Start New Season rewrites every customer in one
press and cannot be undone, and if `removalDone` is meant to persist then clearing it would
tell the warehouse a set is out that is not.

### A regex with a quote in it was hiding two false greens

`escHtmlPrint` in `employee.html` is `/[&<>"']/g` — an apostrophe and a double quote inside
a character class. `matchBrace` has its own quote handling, separate from the comment mask,
and read that apostrophe as opening a string. The string never closed, the brace depth never
returned to zero at the real closing brace, and **that function claimed a range of 35,656
characters** — so every `enclosing()` lookup in that span answered `escHtmlPrint`, including
a write inside a handler twenty thousand characters later. After the fix its range is **177**.

⚠ **It surfaced the day `employee.html` joined the census**, not before: a wrong answer about
a file nothing asked about costs nothing.

⚠ **AND FIXING IT EXPOSED TWO CONNECTIONS THAT HAD BEEN GREEN FOR THE WRONG REASON** — which
is the false green this whole page exists to prevent, occurring in the page itself:

- the `status` row anchored on `status:'closed'` **with no space**, which appears only inside
  comments; the real writes have a space. The anchor landed on prose, and an over-long range
  around it happened to contain a real write.
- the `rsvpRespondedAt` row named `hlxReadSheet`, but the Yes sheet's rule lives in that tab's
  own anonymous `holds` predicate. Same cause: a range longer than the function.

Both are repointed at the code that really does the work. **Neither was ever a broken
connection — they were correct arrows pointing at the wrong place**, and only a scanner
telling the truth could tell the difference.

⚠ **A `/` is divide or regex depending on what precedes it**, so it is decided by the
standard heuristic — after a value it is division, after an operator, comma, bracket or
keyword it opens a literal. Unrecognised, it behaves exactly as it did before, so the safe
direction costs nothing.

### The crew portal is watched now, even though nobody opens it

Until 2026-08-29 `queue-date.test.js` read **only** `admin.html` and `functions/index.js`, and
that absence was the structural reason several holes could sit unseen. The crew portal writes
**six customer states** — the build flag, the recycle flag, the fix flag, `completed`,
`removalDone` and the customer number — and two of the three census gates could not see any
of them.

⚠ **Two of the three were repaired the same day**, once they were visible. The warehouse
toggles now stamp `lightsMarkedBuiltAt` and `lightsRecycledAt` on the tick, the same fields
the office writes — each was one line, and a screen that comes back carrying a known hole is
worse than one that comes back clean. **Neither dates the untick**: un-ticking is somebody
undoing a mis-tick, not a bundle being unmade, and dating it would record work that never
happened over the record of work that did.

⚠ **And its Add a Customer never told the warehouse at all.** A customer entered through the
crew portal got a record with no build flag — so nothing was ever made for them, and a crew
would arrive at a house with no lights for it. Fixed and declared as a real queueing place,
**ungated** on Addie's own ruling (WH-20, *"we want to build everyone"*): that door collects
no colours, so every customer it makes lands in the build queue's *Waiting on light colours*
block, which is visible and has an Add colours button. Gating the flag would make those
houses invisible instead, which is the bug that ruling closed.

⚠ **The third is left, and it is the one that is not a one-liner.** The crew ticking a stop
done writes `completed`, `removalDone` and `needsFix` straight rather than through
`HLX_DONE_KINDS` — which lives in `admin.html`. Dating those three means porting the shared
rule into another file, which is a real job with no reader today and would put a **second
copy of "what done means"** in the codebase unless done properly.

⚠ **They are named, not skipped.** The portal is out of use this season (owner, 2026-08-21:
*"were not using the employee portal this year"*), so `DORMANT_CREW_PORTAL` lists each write
with the reason it is left alone rather than repaired — repairing a screen nobody opens is
work with no reader. Excluding the file instead would mean a **new** undated write could
appear there and nothing would say so, which is exactly the state being closed. Listed, they
are a to-do: if the portal comes back, that list is what to work through first.

⚠ **An exception must still describe something.** A name that no longer matches anything in
the file excuses nothing and hides the rename, so that is checked too.

⚠ **Dormant is not harmless**, which this repo learned once already: `silent-failures.test.js`
sweeps the same file because `whToggleRecycle` cleared a customer number and then swallowed
the pool write, leaving the number on nobody's record and in no pool.

### A payment that finds no bill — an open hole

When a card is captured and the invoice document cannot be found — usually because the phone
or email the bill is keyed on has changed — `recordUnmatchedPayment` files it in
`unmatchedPayments` and texts the office, if an alert number is set. **Three things are then
true at once, and each was checked rather than assumed:**

- nothing anywhere writes `resolved: true`
- **no screen in `admin.html` reads that collection at all**
- `firestore.rules` says `allow write: if false`, so even a screen that existed could not
  mark one dealt with

Meanwhile the customer's own portal reads **Paid in Full**. Real money, correctly captured,
in a place with no way in and no way out.

⚠ **It is drawn on the path as an ending**, because that is what it is today — money in,
nothing out. Drawing a route onward would describe a repair nobody has built, and the value
of that page is that it is true.

⚠ **The fix needs two decisions and a manual deploy**, so it is **Q-025** in
`docs/open-questions.md` rather than a guess: where these should show (Health Check is the
obvious place and the wrong one — HC-03), and who may clear one, since applying it to the
right invoice, refunding it and marking it seen are three different answers about somebody's
money. Letting the office write to that collection also needs a `firestore.rules` change,
which **CI does not deploy** — it needs `firebase deploy --only firestore:rules` by hand.

⚠ **And it is a hole, not a ruling**, so it is deliberately not in the questions map. That
file holds judgement calls she made; a finding of mine put there would be the map describing
itself rather than her.

### Asking to cancel is dated, and on the path

`seasonStatus` carries four answers — a cancellation asked for, an address changed, changes
needed, changes settled — and until 2026-08-29 **not one of them was dated**. A search for a
date on it across every source returned nothing at all.

⚠ **The cancellation is the one that costs.** A customer asks through the Cancel tab of their
own portal; their old set is queued to come back and they come off every upcoming route
immediately, but they stay a customer until somebody in the office acts. With no date the
queue could not be sorted by how long anybody had waited — a request made in October read
exactly like one made this morning, with a crew still notionally coming either way.

⚠ **The previous value travels with the date.** "Changed on the 4th" cannot say whether they
were cancelling or correcting an address, and those need opposite actions, so
`seasonStatusWas` rides alongside `seasonStatusAt` and the history line says which it was.

⚠ **On the transition only**, like every other stamp: `portalSave` writes the status on saves
that did not change it, so re-stamping would reset the clock every time a customer opened
their portal and pressed save.

⚠ **Three writers, and the third was missed until a census went looking** — `declineAsksAboutLastYear`
settles a customer's changes, which is as much a status change as asking for them.

⚠ **And it was the biggest hole in the path.** Asking to cancel is a door out of the season
distinct from declining a quote and from answering the RSVP no, and the graph had no step for
it at all.

### Every door to a fix carries a date

There are four ways to raise or clear a fault, and until 2026-08-29 **two of them wrote the
flag bare**. The customer-row dropdown did it five lines under a comment stating that all
three of its fields come from the shared rule — `completed` and `removalDone` did, `needsFix`
did not — and the Routes tab toggle did the same. So a fault raised from either recorded no
`fixRaisedAt`, and mending one recorded no `fixDoneAt`.

⚠ **It is money, not tidiness.** A fault on a completed house stops that payer's **whole
group** being invoiced (`skippedNeedsFix` in the nightly run), and the hold is recomputed from
the flag every night. Undated, a bill held six weeks looked exactly like one held since this
morning, and nothing anywhere could sort the queue by how long.

⚠ **The existing check could not see it.** It asserted the shared rule is *called* somewhere —
true, while two of the four callers went round it. Presence is not coverage. `queue-date.test.js`
now censuses every place that writes the flag: each is either a door that must go through
`HLX_DONE_KINDS.fix`, or is named with the reason it is not one. Two are deliberately not doors
— `buildAddressRowHtml` reads the flag into markup, and `planTickCustomer` mirrors it into the
local cache before the write is awaited so the derived tick does not spring back.

### Are the rules still accurate?

Every ruling in the questions map names the code that proves it, and until 2026-08-29
**nothing had ever checked those names were real**. `questions-map.test.js` now does, and it
found two on its first run: **MR-20** pointed at `RM_LOOK_SENSITIVITY`, a constant that has
never existed in this repo; **QT-13** still read *Standing* while naming a Firestore document
removed on 2026-08-27 along with the whole feature it belonged to.

⚠ **A rename is the common case and it is silent.** Functions are renamed constantly, the map
is prose and never moves with them, so it drifts one rename at a time — and the day somebody
needs a ruling is the day they discover its pointer leads nowhere.

⚠ **Standing rows fail; superseded and closed rows only note.** Naming code that has since
gone is what *superseded* means. A standing ruling claims to describe how the app works today,
so its own pointer has to lead somewhere.

⚠ **Backticks mean "look here".** A dead name being *quoted* rather than pointed at must not
wear them — caught within a minute, because the fix to MR-20 named the dead constant in
backticks while explaining that it was dead, and the check flagged its own correction.

⚠ **It reads source, not tests.** Red-checking removed a function from `admin.html` entirely
and the gate stayed green, because the suite that lifts that function still named it — the
anchor "existed" in a file whose only job is to talk about the code.

⚠ **And the first version cried wolf on all three of its findings** — an element id
(`#rmDifficulty`), a Firestore path (`settings/measureAlign`) and a value on a record
(`kind:'carried'`), each of which leads exactly where it says. On a gate whose whole job is to
be believed, three false alarms out of three is worse than finding nothing, so an anchor is
broken into the names inside it and every one must exist. ⚠ **Its own limit, stated rather than
overclaimed:** it proves a name appears *somewhere in source*, so a definition renamed while
its callers still use the old name reads as present. The suites that *lift* those functions
are what catch that.

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
