# Highlighting Utah — System Map

Written for Addie (non-coder) by Claude Code from a full read-through of the real code. This explains how the app actually works today, not how it used to work — where this disagrees with old notes or your own memory of a feature, trust this document and flag it if something seems off.

**Kept current with every change, not regenerated occasionally** (Addie, 2026-08-26: "system map should be every time"). First written 2026-08-08; last brought up to date **2026-08-26**. ⚠ It is UPDATED rather than rewritten from scratch — a wholesale regenerate loses the hard-won detail in it and risks introducing errors into the one document written to be trusted. If a section here contradicts the code, the code is right and this is a bug in the map.

---

## 1. The lifecycle, start to finish

1. **Public quote** — a visitor fills out the quote form on the public site. It's saved to `quotes` with `status: 'new'`. No photo is attached automatically anymore (see §9).
2. **Office prices it, then sends it** — a staff member opens the quote card in Admin, fills in estimated feet and a quoted price, and sends it one of two ways. Both save a `quoteToken`, and that token is the whole of how the customer is later recognised.
   - **Send quote email** (the gold button) saves `quotedPrice` and the token, then emails the long link, `https://highlightingutah.com/#/quote-details?token=...`.
   - **Send as text instead** sends the short one, `highlightingutah.com/q/<token>` — the same page by a different address, about 40 characters shorter, which is what keeps a quote text inside one billed message. Netlify rewrites `/q/*` to the app and the app turns the path back into the same route the long link uses, so both spellings work for ever and every quote ever created already works at both.
   - ⚠ **index.html is served at THREE paths** — `/`, `/home` and `/q/<token>` — so every import in it must be **root-absolute**. `"./js/money.js"` resolved to `/q/js/money.js` under the short link, 404'd, and killed the whole module: every script on the page dead, header and footer still drawn because they are static HTML. That blank page is what a quote text delivered from 2026-08-26 until 2026-08-31, and nothing went red — the checks proved the redirect rule and the path pattern, neither of which requires the page to boot.
   - ⚠ **A quote reaches the text button without ever having been emailed**, so the text path mints the token itself (`ensureQuoteToken`) rather than assuming the email path already did. It did assume that until 2026-08-30, and the result was a link ending in a bare `/q/` — well-formed, accepted by the phone, and refused by the router, so the customer landed on the homepage instead of the quote and the office was told the text had sent, because it had. If the token cannot be saved, nothing is sent at all.
2b. **Held off the schedule while the warehouse builds (72 working hours).** Anything that newly queues a build — a re-quote topping up, a re-quote recycling and rebuilding, or a colour/wire/timer change — stamps `scheduleHoldUntil` 72 hours ahead, counting **only working days**: weekends and Thanksgiving do not tick. A Friday afternoon re-quote is schedulable Wednesday afternoon. Nothing puts that house on a crew day until the hold expires (`isHeldFromRoutes`, asked by the route builder, the leftover check and the schedule adder alike).
   - ⚠ **This is NOT the free-colour-change window.** `lightsLockedUntil` decides whether a colour change is free, and it is still 48 hours — widening it would charge the $30 less often, which is a money change nobody asked for. Two fields, two reasons: the old one is "so they can change their lights again", this one is "so the bundle exists before a crew is sent".
   - ⚠ It is set only when the build is **newly** queued. Re-saving an already-queued house must not push the hold out again, or a built house stays off the routes for ever.
   - ⭐ **A hold is a later first day now, not a disappearance** (2026-09-04, SCH-48). The schedule used to honour this by leaving the customer **off the plan altogether** — and absent-from-the-plan is how that screen says *out for the season*, so a customer waiting three days for a bundle looked exactly like one who had said no. `houseHoldFrom` turns the hold into the first **working** day after it expires and feeds that into the same `from` the install preferences already use, later-of-the-two wins. They are on the plan, counted and visible, and still cannot land on a day inside the window. The day after, not the day itself: a hold ending at two in the afternoon still covers that morning, and the crew leaves in the morning.
   - ⭐ **And the rule now reaches the six paths that never stamped it.** Only the Edit Customer save ever wrote `scheduleHoldUntil` — Add Customer, a converted quote, the portal colour change, the server re-quote, Send to warehouse and a rejoin after recycle all set `needsLightBuild` on its own, so *"isnt scheduled until 72 hours after sent to warehouse"* was true for one route in of seven. `scheduleHoldEndsMillis` derives the same 72 working hours from `lightsQueuedAt` where nothing was stamped, and **`isHeldFromRoutes` is now derived from it** rather than reading the two fields itself — one place knows about the holds, the route side asks whether it is non-zero and the schedule asks what day it lands on. ⚠ This is a real **widening** of who is held off crew routes and it is deliberate, and
**a brand-new customer is in it** — asked as its own question because it is the widening's
loudest consequence (somebody added today waits about three working days for a crew), and
answered *"keep the 72 hour hold for new customers too"* (SCH-48). ⛔ Do not add a
new-customer exemption: it is the obvious-looking kindness, and it is the case where the
bundle is least likely to exist. ⚠ An **undated** `needsLightBuild` holds nobody: treating "unknown" as "now" restarts the clock on every rebuild, which is a for-ever hold wearing a timestamp.
   - ⛔ **The gate that had no clock in it at all, removed 2026-09-04.** `customersMissingFromSeason` also carried a bare `needsLightBuild === true`. That flag is cleared by the warehouse marking a bundle made and by nothing else, so a bundle nobody got round to kept a paid-up, **confirmed** customer off the schedule for the whole season, silently. It was superseded two days after it shipped by the timed hold above and nobody removed it — two rules for one fact, and the one without a clock won. This is the bug behind SCH-48.

3. **Customer approves** — the customer opens that link (no login needed) and approves or declines. This calls the `quoteRespond` Cloud Function, which is how an unauthenticated visitor is allowed to touch the `quotes` collection at all.
   - **A link that no longer matches a quote says so.** `quoteRespond` and `portalRsvp` report a miss by *throwing*, which makes the call **reject** on the customer's end — so until 2026-08-31 every such link showed "Something went wrong", the wording meant for a server fault, and the accurate "we couldn't find your quote" line could never appear. An out-of-date link is ordinary (the quote was deleted, or re-sent), so it now says the link may be out of date and to ask for a fresh one. `portalCallFailedText` is the one place that wording lives, and all six branches ask it.
   - ⚠ **A genuine outage still reads as one.** Anything that is not a not-found keeps the generic message, and the real error is logged to the console — calling every failure a stale link would hide a real fault behind a reassuring sentence.
   - ⚠ **Approved is not the same as Ready to Convert.** That folder means approved **and** the install-details form completed, so nothing lands there half-filled. A new customer approving gets that form. An **existing member does not** — they are asked "anything changing this year?" instead — so an approved re-quote stays in **Awaiting Response** until the office presses Mark Approved. Known gap, not yet decided.
4. **Convert to customer** — a staff member clicks "Convert to Customer" on the approved quote and is asked which way:
   - **Convert automatically** — saves them there and then, using everything the quote already holds, without leaving the Quotes tab. The popup lists anything the quote is missing *before* it runs, and the result is reported in a toast (customer number, bin count, whether they reached the Warehouse, whether the $30 fee was charged, and anything still missing).
   - **Fill in manually** — opens the Add a Customer form already filled in, so the gaps can be typed in first. This is what the button used to do on its own.

   Both copy the same details (name, phone, colors, wire color, install timing, gate code, outlet timer, specific outlet, notes, wants-mailed-invoice, photo, contact method, the $30 set-up fee decision, and the *approved* price — never a recalculated one) and both create the `jobAddresses` document through the **same** Add Customer submit handler: automatic fills the form and submits it rather than writing its own record, so the customer number, invoice, warehouse build flag and auto-scheduling cannot drift apart from the manual path. The quote is marked `status: 'closed'` with `convertedToCustomerAt` set.

   *The light colours decide WHICH build group a house lands in, not whether it is queued at all.* Conversion still falls back to the quote's own wording when no colour boxes were ticked, so a pattern typed as free text is not lost. ⚠ **Corrected 2026-08-26:** this used to say `needsLightBuild` was set FROM `lightsDescription`. It is not, and has not been since 2026-08-21 — every new house is flagged, colours or no colours (questions map WH-17, WH-20). A house with no colours goes to the warehouse's own "Waiting on light colours" block, which is visible and has an Add colours button; leaving it unflagged made those houses invisible instead, which was the bug. ⛔ **And its TIMER is not waiting on any of that** (2026-09-09, [[WH-26]]). Changing a timer alone queues a build — `outletTimer` is one of the three `WAREHOUSE_BUILD_FIELDS` — so a house with no colours that asked only for a timer landed in this block. The damage was that `whBuildQueueGroups` collected timers AFTER the blocked branch returned, so such a house never reached the timer list at all: the one thing it actually needed was the one thing no sheet asked for. Timers are collected first now, the house stays blocked for the BUILD, and the row says the timer can go in today. ⭐ **And then the house stopped being parked at all** (2026-09-09, [[WH-27]]) — Addie, shown the cause: *"can you fix those."* A timer change on its own now sets **`needsTimerOnly`**, the timer's own queue, instead of `needsLightBuild`. Those houses appear on the **Timers** list badged *Timer only*, with a **Timer in the bin** button to finish them, and they are **not** on the Waiting-on-light-colours list — because nothing is being made up for them, so there are no colours to wait for and nothing for the office to chase. ⚠ It never switches the build flag off: a real build queued for any other reason wins on its own, which is why it is a separate flag rather than a marker on the existing one. ⭐ **And turning a timer OFF is now its own job too** (2026-09-11, [[WH-34]]) — Addie: *"For people who don't want a timer anymore we need to put that in warehouse as Remove Timer."* That sentence used to read *"turning a timer off still queues a rebuild, deliberately — the timer list only ever collects Yes, so a removal routed there would vanish off every screen"*, which was true while there was nowhere for a removal to go. There is now: **`needsTimerRemoved`** and a **Remove Timer** block directly under Timers, with a **Timer taken out** button on every row. ⛔ It has to be a stored flag, and that is the one thing to protect here: *wants a timer* can be read off the record for ever (`outletTimer === 'Yes'`), so the Timers list is derived and a missed flag heals itself — but *used to want one* is readable off **nothing** the moment the save lands, because that house then looks exactly like the ~900 that never had one. If the save does not write it down, nobody is ever told and the timer stays in their bin all season. So it is written at **both** doors: the Edit Customer save and `portalSave`, since a customer switching their own timer off from their phone is the commonest way this happens. ⚠ It is taken back if they switch it on again before anybody has been to the shelf — nothing has been pulled while the flag is up — and once the warehouse presses Timer taken out the flag is already down. ⚠ The Remove Timer block is never folded into Timers: they are one walk round the same shelves and opposite instructions at the end of it. ⚠ Its Done clears the removal and **nothing else**, so a house also having a set made stays in its colour group and is still built. ⚠ A wire change, or a timer change on a house that **has** colours, is still a build exactly as before — only the colourless case is routed away. ⭐ And both timer jobs reach **paper** for the first time: a timer-only house was in no group and not blocked, so it fell through both loops of `whSheetRowsForBuild` and was on the screen but on no sheet at all. The removal row's Timer column reads **TAKE OUT**, never YES. ⚠ And a wire change, or a timer change on a house that **has** colours, is still a build exactly as before. **The five houses already sitting on that list carry no flag**, so each blocked row that has a timer on file now offers **Only needed a timer** — one press moves that house across, and *Build Them A New Set* on their record undoes it. Only a person can make that call: nothing on the record can tell a house queued by a timer change from one converted with its colours still to come. ⚠ Do not "fix" this by dropping `outletTimer` from that field list — the timer list is derived from the build queue, so a house that stopped being queued would stop getting a timer at all.
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
11. **RSVP "no"** — records the answer and takes them off any upcoming route. **It does NOT touch their lights** (changed 2026-09-03, RS-51). Dax: *"when they click no they move to maybe next year and only go to archive if they actually go through the process of canceling their lights in member portal."* `seasonBadgeKey` already reads a bare `no` as **Maybe Next Year**, so that is what the office sees.

    ⛔ **`needsLightRecycle` now has exactly one door: `portalSave`'s `cancel` section** — the Cancel tab a No lands them on (RS-33), where they press *Cancel My Lights*. That is the step which takes the bundle apart and returns the customer number to the pool, and it used to fire off a single tap in an email with no confirmation anywhere in front of it. A misread email cost a rebuild.

    ⚠ **THE COST, TAKEN KNOWINGLY:** a customer who says no and never cancels keeps their bin and their customer number for the season. Under the old rule that number came back to `availableCustomerNumbers` on the answer alone. Fewer numbers recycle; nothing is destroyed by mistake.

    ⚠ **AND HALF AN OWNER RULING IS REVERSED HERE, out loud.** Addie asked for the back-next-year-then-no sequence and was answered *"they belong on the recycle list, and NOT on Contact 2027 as well"*. The Contact 2027 half stands — a no still clears `maybeNextYear`. The recycle half is Dax's later call (R-024).

    ⭐ **AND IT IS ADDIE'S RULE NOW TOO** (2026-09-11, [[RS-61]]). She said it in her own words: *"they will only be a real no if they cancelled member portal."* Nothing about the rule changes — what changes is that it no longer rests on one person's call, which [[RS-55]] had flagged as unsettled. ⚠ **WHAT PROMPTED IT WAS A TEST FAKE THAT AGREED WITH THE OLD RULE:** `test/firebase-stub.js` went on writing `needsLightRecycle` on a No for eight days after the server stopped, so a browser spec asserted the reversed rule and passed. A stub that has drifted from the server is a spec proving the opposite of what the app does, and nothing goes red. ⚠ **AND AN OWED RECYCLE STILL SURVIVES A No** — somebody who cancelled properly and then answers the RSVP again keeps the collection the warehouse is queued for. Both halves now have a browser test.

    ⭐ **AND SOMEBODY IS TOLD, AND THEN ASKED WHY** (2026-09-11, RS-59 and RS-60). A decline used to write **nothing to the Inbox at all** — the record changed, they came off every route and their referral was clawed back, in silence, on the most consequential answer in the season. `portalRsvp` now raises a note under **RSVP — Not This Year** or **RSVP — Back Next Year**, and those two strings are the folders the Inbox files them into, under a **No RSVPs** section of its own. On the TRANSITION only, and best-effort: their answer is already written by that line.

    ⭐ **THE REASON IS OPTIONAL AND IT PICKS THE FOLDER.** Addie: *"okay i need it to be optional choice"*, then *"Should be Moved, Finances, etc."* The portal offers **Moved · Finances · Doing it ourselves · Another company · Not decorating · Other** — one list (`RSVP_DECLINE_REASONS`) held identically in `index.html`, `functions/index.js` and `admin.html`, because these strings are **folder names** and one character apart files a real answer where nobody is looking.
    - ⛔ **The answer is recorded FIRST and the reason asked afterwards.** It is a second call for exactly that reason and it writes no `rsvpStatus` of its own — somebody who closes the tab on the picker has still declined, and a stale retry cannot overwrite a newer decision.
    - ⛔ **`Other` carries their own words, and those words never name a folder.** The reason picked is held to the list and names the folder; the typed note is stored beside it and appended to the note the office reads. This is a public callable: a folder named by whatever a stranger typed is both a mess and a way in.
    - ⭐ **`Moved` can undo the no.** Addie: *"Moved should also give option change address which will keep them and confrim them for that year along with send them to requotes."* The button opens the existing move form (QT-35); the move it sends is marked `fromDecline`, and the server puts them back in the season through `seasonYesUpdates` — never a hand-written yes, which would leave them confirmed AND queued for recycling. ⛔ **Both conditions**: the browser says where the request came from, but the RECORD has to say they actually declined, or a flag from a public callable would confirm anybody.
    - ⚠ **Where it appears.** One block, MOVED into whichever panel is open — a decline from the email link lands on **Cancel** (RS-33) while the in-portal Yes/No buttons are on **Changes**. Built on one of them it was invisible to half the people it is for, and a browser is the only thing that found that.
    - ⚠ **And the block above it had been lying.** The portal opened from an RSVP link renders from the **invoice** record, which carries no `rsvpStatus`, so *"Are you having lights this season?"* answered *"You haven't told us yet."* to somebody who had answered a second earlier. The answer this visit recorded is remembered and wins; `portalRsvp` also returns any reason already on file, so a later visit is not asked again.

   ⭐ **WHERE THE THREE RSVP EMAIL BUTTONS LAND** (corrected 2026-08-31). The buttons are built by `applyEmailTokens` in `admin.html` — `{{rsvp_yes_button}}`, `{{rsvp_no_button}}`, `{{rsvp_back_button}}` — and each one carries the customer's own portal token:

   | Button | Link | Answer saved | What the customer sees |
   |---|---|---|---|
   | **Yes** | `#/payment?token=…&rsvp=yes` | `yes` | **Their member portal opens by itself**, with the gate-code question as a pop-up over it — no confirmation screen, no button to press (RS-33, RS-35) |
   | **No** | `#/payment?token=…&rsvp=no` | `no` | recorded, then **straight into the member portal** on the Cancel tab (RS-33) |
   | **Back Next Year** | `#/?token=…&rsvp=back` | `backnextyear` | a **pop-up card** — "We look forward to seeing you next year!" (RS-34) |

   ⭐ **A YES ENDS IN THE PORTAL, NOT ON A QUESTION** (changed 2026-09-01, RS-33). Dax: the RSVP buttons
   *"dont do anythng we need but it needs to change the customers badge and it should also automatically
   send the customer to their member portal."* The badge half was already working and was checked before
   anything was built — all three buttons call `portalRsvp`, `seasonBadgeKey` derives the badge from
   `rsvpStatus`, and two live customers read *RSVP: Yes — CONFIRMED*. What changed is the routing:
   `showChangesQuestion` ("You're confirmed! Do you want to make any changes?", with the portal behind a
   button) is replaced by `openPortalAfterYes`, which tears the card down and calls `loadPortalByToken`.

   - ⛔ **THE ARREARS HOLD IS RAISED BY THE RENDER AND IS NOBODY ELSE'S JOB** (2026-09-03). It used to be the
     gate-code dialog's `thenFn`, and the render only raised it when no caller had supplied an `onPortalReady`
     — a **payment rule behind a cosmetic dialog**. Narrowing the gate question (RS-44) came within one line of
     switching it off, and the `else` had already left the post-payment re-render with no hold at all, so a
     customer who paid part of what they owed landed in a locked portal with nothing saying why.
     `renderCustomerInvoicePage` now calls `showArrearsLockIfHeld()` unconditionally, and that function **waits
     for the gate question to close** rather than being called back by it — same ordering, no chain. Do not pass
     it in as anybody's callback again; run-all Suite 291 fails if you do.
   - ⚠ **Only a customer who ALREADY has a gate code is asked** (2026-09-02, RS-44). Dax: *"only applys to
     people that already have a gate code in the system so not everyone is seeing it."* The value is catching a
     code that went stale over the summer before a crew is stood at a locked gate; asking the majority, who have
     no gate at all, was a toll on the way into their own portal. `showRsvpGateCodeStep` returns before drawing
     anything when there is no code on file — **and still calls `thenFn`**, because that is what raises the
     arrears pop-up behind it. The entry box is now reached only by *It has changed*, which makes RS-32's
     contrast fix load-bearing rather than cosmetic.
   - ⚠ **The gate-code question stays, and since 2026-09-02 it is not in between at all** (RS-35). Dax:
     *"gate codes change so make sure it asks if theres a gate code"* — RS-29 reaffirmed, not reversed, and
     since narrowed to customers who already have one (RS-44) —
     then *"after they answer the gate code question it should just put them into their member portal"*
     and *"make it so the gate code question is just a pop up in the member portal but keep the buttons
     exactly as is instead of an entire page."* So the portal loads first and the question arrives **on
     top of it**, in `#rsvpGateCodeModal`. The buttons, their ids and their wording did not change; the
     frame around them did. `renderCustomerInvoicePage` calls `opts.onPortalReady` as the last line of a
     successful render, and that is the only thing that opens the dialog — every early return (deactivated,
     wrong last name, no invoice) is somebody who did not get in, so the question can never float over an
     error message. Escape and the backdrop close it and write nothing.
   - ⚠ **Yes only.** No still gets its message before the Cancel tab — Addie's 2026-08-19 ruling, *"put a
     message in front of it first so they know why they've landed there"* — and Back Next Year is untouched.
   - ⚠ **The debt sentence moved rather than being dropped.** The removed screen told a debtor we could not
     book them; that line is now on the portal's own *"<year> season — still owing"* card, where it is true
     whenever they open the page instead of only just after an RSVP.
   - ⚠ **The second answer used to be invisible, and that hid a dead end** (fixed
     2026-09-01, RS-32). `.btn-outline` is the DARK hero's button — white text on a
     35%-white border — so on these light cards it rendered white-on-white. On a
     customer who already has a gate code the answers are *Yes, that's right* and
     ***It has changed***, and that second one is the only route to the entry box, so
     while it could not be seen a changed gate code could not be reported at all. The
     No path's *That's all, thanks* was the same. The three cards now override the
     class by id; `test/rsvp-gate-code.spec.js` measures the real computed contrast,
     because jsdom applies no stylesheet and cannot see a colour.
   - ⚠ **And minimal mode ends there by design.** `openPortalAfterYes` removes `rsvp-minimal`/`rsvp-back`,
     exactly as the old *Take Me to My Portal* button did — a receipt is right for a card, wrong for an
     account page. The no and back-next-year paths still end on the receipt.
   - ⭐ **AND A NO IS ASKED WHY, ONCE IT IS IN** (2026-09-11, [[RS-60]]). The optional reason picker is
     drawn only for a record that already says no or back next year and has not answered it — which is
     what makes it optional rather than a step. ⚠ **It follows them between tabs**: a decline from the
     email link lands on **Cancel**, the in-portal Yes/No buttons are on **Changes**, and there is ONE
     block moved into whichever panel is open rather than a copy on each. ⚠ **And the RSVP block reads
     the answer this visit recorded** (`portalRsvpStatusOf`), because on the link route the page renders
     from the INVOICE record — thirteen fields, no RSVP among them — so it had been saying *"You haven't
     told us yet."* to somebody who had answered a second earlier, and the picker keyed off the same
     blank. Every source check passed the whole time; a browser is what found it.
     ⚠ **AND IT NOW SITS BEHIND THE TAP** ([[RS-57]], the same day and from another branch).
     The link no longer answers on open, so the answer this visit recorded is the one the
     TAP recorded — which is exactly where the picker should appear, and it is why every
     browser spec that opens an RSVP link taps through `tapRsvpConfirm` first.

   ⭐ **AND SOMEBODY WHO OWES FOR LAST SEASON IS HELD BEFORE ANY OF IT** (2026-09-02, RS-36). Dax:
   *"make sure it forces them to pay for their last year lights before they can do anything and before
   anything goes into the system."* Three things hold it, and the screen is the weakest:

   | | What it does | Why it is that one |
   |---|---|---|
   | **The pop-up** | `#arrearsLockModal` — the amount, *"we can't put you on this season's schedule until it is paid in full"*, and one button that lands them on the pay buttons | No close, no Escape, no backdrop click, unlike every other dialog here. It comes **after** the gate code, and back on every visit until it clears |
   | **The tabs** | Information, Sides, Light Colors and Changes are disabled | Payment, **Contact** and **Cancel** stay open — see below |
   | **`portalSave`** | refuses the write, before it reads a single field | The callable is public; a hidden tab is not a lock. This is the half that makes *"before anything goes into the system"* true |

   - ⚠ **The RSVP answer is never held.** It is recorded before the portal loads (RS-33), and a customer who
     owes is exactly the one whose yes or no the office most needs.
   - ⚠ **Cancelling is never held.** Somebody trying to leave must not be told to pay first, or they stop
     replying and Addie never learns why. `portalSave` exempts `section === 'cancel'` by name.
   - ⚠ **Contact stays open** because the card itself says to ring if the figure looks wrong; a locked dispute
     route turns a disagreement into silence.
   - ⚠ **The gate code still saves** for anybody it is asked of, because it is asked first — and since 2026-09-02 (RS-44) it is asked only of somebody who already has one on file.
   - ⚠ **It fails open** — an unreadable invoice answers nought and nobody is held, the opposite direction to
     the season hold. A change slipping through costs a form field; a customer locked out of their own account
     costs a phone call.
   - ⚠ **A carried line that has been PAID does not hold anybody.** The note stays on the invoice for ever;
     what decides it is `arrearsOutstanding`, the server's figure, never a fourth copy of the maths.

   ⛔ **AND THE CHASE FOR THAT MONEY IS BUILT BUT SWITCHED OFF** (2026-09-02, RS-39). Dax asked for the
   unpaid-last-season email to send itself. `sendArrearsRsvpEmails` runs daily at 10:00 AM and returns
   immediately unless `settings/arrearsRsvpAutomation.enabled` is true — an absent document is **off**, which
   is the shipped state, because MON-34 is Addie's standing ruling that she would send these herself. Her
   sentence is printed on the card beside the switch. **Admin › Invoices › Unpaid Last Season** holds the
   switch and a *Send Once, Now* button that runs the same batch without turning anything on.

   ⚠ **AND ON 2026-09-07 IT WAS SWITCHED ON** (RS-55). Dax: *"turn the first one on."* The shipped state is
   still off — this is a value in Firestore, not a code change — but `settings/arrearsRsvpAutomation.enabled`
   now reads `true` in production, so the 10:00 America/Denver run sends for real, daily. **It reverses
   MON-34, which is Addie's and is deliberately left Standing**; the card beside the switch says as much
   ("worth a word with her first"). At the moment it was turned on the batch resolved to **19 customers,
   $7,487.04, all 2025 arrears** — the rest skipping as owing nothing (929), already answered (5), no email
   (2), or the test record (1). ⚠ Anyone reading this because a customer was chased twice wants
   `arrearsRsvpEmailAt`, not the schedule: the switch decides whether it runs, that stamp decides who it
   reaches. And a one-time send never needed the switch at all — *Send Once, Now* was always there.

   - **Who it writes to:** owes for a previous season **and has never answered the RSVP**. Not a no, not a
     back-next-year (RS-30 — they have answered), and not a yes (the template asks whether they want lights,
     which to somebody who already said so reads as us losing their answer).
   - **Once per customer per season**, via `arrearsRsvpEmailAt`, cleared by Start New Season — and stamped
     only *after* the send succeeds, so a refused send does not silently drop them for the year.
   - **No figure in the email.** There is no token for the carried balance and `{{amount_due}}` means this
     year's install price (RS-37), so the buttons carry their portal token and the portal shows the figure.
     ⚠ **What that forbids is an INVENTED figure, not the `$` sign.** The shipped body carries the referral
     offer, which is a fixed $25 on every email and cannot be mistaken for a balance; the check asserts that
     every dollar figure in the body IS that constant. It used to assert no `$` at all, which was true of the
     test fixture and never of the real template — a check that held for the harness and not for production.
   - The **test record carries Addie's own phone**, so it is skipped by flag and by name-and-number both.

   ⭐ **THE TWO RSVP EMAILS SPLIT THE BOOK BETWEEN THEM** (2026-09-07, REF-16). Dax: *"both emails will be
   sent seperately but at the same time."* ⚠ **The overlap was real and silent.** This batch writes to
   somebody who owes AND has not answered; the standard RSVP's audience is returning customers who have not
   answered — the same people plus everybody else. Sent on different days the stagger hid it; sent together,
   every customer carrying a balance gets two emails within a minute, one of which says nothing about the
   balance and hands them a Yes button that cannot put them on the schedule.
   - **Choosing the template now picks its half.** The Not Paid RSVP sets the *Paid last year* filter to
     Unpaid; any other RSVP template sets it to Paid. Together they are the whole book exactly once.
   - ⚠ **A default, not a lock** — the same standing the *New vs returning* filter beside it has (RS-07).
     She can set it back to All; what she cannot do is arrive at the overlap without choosing it.
   - ⚠ It leans on `etFilterPaidLast`, repointed on 2026-09-05 to read the **live** arrears rather than a
     snapshot nobody writes. That fix is the only reason this filter can be trusted to carry the split.
   - **And it drops anyone who has already answered** (2026-09-07, RS-54). Dax: *"exclude people who are
     confrmed."* Choosing either RSVP template also sets the *RSVP* filter to **Not answered yet**.
     ⚠ **This was the last of the three send paths to do it**, which is why it survived so long: the nightly
     chase skips on `if (answered) continue;` in `runArrearsRsvpBatch`, and *Send the whole RSVP* skips on
     `effectiveRsvpStatus(d)` in `rsvpWholePlan`, so only Preview & Send — the one path driven by hand —
     re-asked the people who had already replied. Three paths asking one question of different books is the
     same failure shape as two senders over one book, and it reads to a customer as the office losing their
     answer. ⚠ **`pending` is not `blank`**: `etRsvpAnswered` counts the literal status `unanswered` as
     still unanswered, so that customer stays in the audience — they have not answered, they have only been
     asked. A default, not a lock, like the two filters beside it, and the count line names itself.

   ⭐ **AND WHEN THEY PAY, EVERYTHING MOVES — INCLUDING THE OFFICE SCREEN** (2026-09-02, RS-40). Every
   figure on an All Customers row is derived live from the invoice, so a portal payment already cleared the
   *Unpaid 2025* tag, moved the bill Unpaid → Partial → Paid in Full, and moved a yes-sayer from **On hold**
   to **Confirmed**. What was missing was the repaint: the invoices listener drew the invoice list, the
   routes, the takedowns and the dashboard, and not All Customers — so the row stayed stale until somebody
   navigated away and back. It repaints now.

   - ⚠ **Money is not consent.** Somebody who pays and has never answered stays **Pending**, whether they
     paid last season's carry or this year's bill in full. A bare stored `yes` with no `rsvpRespondedAt`
     behind it does not count either (RS-19). Confirmed would send a crew to a house nobody asked for.
   - ⭐ **So the question is asked the moment the payment lands** — `#rsvpAskModal` over their own portal,
     three answers, wired through the page's existing `data-portalrsvp` handler rather than a second copy.
     It closes, unlike the arrears lock: that one withholds something until they pay, this is asked of
     somebody who just did.
   - ⭐ **The backstop is the System note**, widened past RS-30: any customer with money in and no answer
     raises one, not only somebody who cleared an old debt. A no or a back next year still raises nothing.
   - ⚠ **`rsvpRespondedAt` is now sent to the portal.** Three server paths wrote it and nobody sent it, so
     the browser could not tell a real yes from an imported one — the new question would have been put to
     customers who had already answered. `portal-fields.test.js` caught it.

   ⚠ **A PREBUILT TEMPLATE THAT EXISTS BUT IS EMPTY IS FILLED IN** (2026-09-02, RS-41). The one-time top-up
   skipped any template whose NAME was already there — so a shell somebody had made by hand stayed blank and
   would have sent an empty email, with the seed record saying the job was done. It now patches blank fields
   (body, subject, linkedTokens) on any prebuilt-named template, never replaces written words, and is
   deliberately not gated on that seed record: the fault is only visible after the name has been recorded as
   handled.

   ⚠ **THE SIDES TAB HAD NEVER OPENED** (fixed 2026-09-02, RS-38). `sides` was missing from `PORTAL_TAB_NAMES`,
   so clicking it hid the other six panels and showed none — a blank card under the tab strip. Found while
   building the hold above; nobody had reported it. Every `data-tab` on the page must now appear in that list.

   All three are a **receipt, not the website**: the header, footer and hero come off, and nothing else is reachable from the page. That is `body.rsvp-minimal`, which force-shows `#page-payment` (holding `#rsvpConfirmCard`) for the first two, plus the modifier `body.rsvp-minimal.rsvp-back`, which force-shows `#page-home` (holding `#backNextYearConfirm`) for the third.

   ⚠ **AND THAT IS WHY THE GATE-CODE DIALOG IS NOT INSIDE `#rsvpConfirmCard`.** Both answers now leave that
   card within a moment, so a dialog nested in it would be torn down by the very step that opens it. It sits
   at the top level of the payment page instead, `position:fixed` with a dimmed backdrop over everything —
   including the portal's `position:fixed` phone tab bar, which is the one thing on the page that could
   otherwise be tapped straight through it.

   ⚠ **ONE CLASS USED TO SERVE BOTH CARDS AND SHOWED BOTH PAGES** (fixed 2026-09-01). Addie, over a screenshot of a bare *"One moment…"*: *"this is what happens when I open up Yes or No, but back next year seems to be working"* — and that sentence is the whole diagnosis. The two answers land on **different cards in different pages**, and `body.rsvp-minimal` force-showed *both*. So a Yes or a No opened with the Back Next Year card sitting above it, still holding the **static `One moment…` from the markup** that only `handleBackNextYear` ever rewrites. The real confirmation rendered perfectly, below the fold, under a dead card.
   - ⚠ **It looked like a hang and was not.** The answer was recorded, the message was built, and the customer stared at *"One moment…"* for ever — the same shape as the bug this class was *introduced* to fix, which is how it hid inside the fix.
   - ⚠ **Back Next Year was leaking too**, and it was only invisible because the right message happened to be on top: that route left `#page-payment` open underneath, so the **sign-in form sat below the goodbye**.
   - ⚠ **The specs asserted what the right card said, and never that no other card was on screen.** That is the gap; `test/rsvp-link.spec.js` now checks each route shows exactly one card and leaves no visible *"One moment"* anywhere. Four sabotages red-checked, including the original bug put back verbatim.

   ⚠ **AND THE OFFICE'S OWN DROPDOWN WAS BEING OVERRULED** (fixed 2026-09-02). Addie: *"RSVP still says yes even though I just tried to update it."* Two controls described one state — a *This Season* **Back Next Year radio** and the **RSVP dropdown** — and the save read an unticked radio as *"the office is bringing them back in"*, so it cleared `rsvpStatus` to blank. Her customer already carried the flag from earlier testing, so choosing Back Next Year blanked the answer — and a blank on a quote-converted customer reads as **Yes** (`audienceNeverAsked`). She set an answer and the save stored its opposite.

   ⭐ **AND THE SECOND CONTROL IS NOW GONE, WHICH IS THE REAL FIX** (RS-43). Addie, the next day: *"I don't understand why this is seperate. It should not have two seperate RSVP spots in costumer."* The radio pair is removed and **`#editCustRsvp` is the only control for this state**; `seasonMaybeChosen` is derived from it alone.
   - ⚠ **Nothing went with it.** The dropdown carries five states against the radio's two, and picking Back Next Year there already did everything the radio did — the flag, the timestamp, off the build queue, off the schedule, off any upcoming route. The radio could not express **No**, **Unanswered** or **Pending** at all.
   - ⚠ **The first fix went with it too, on purpose.** That one compared the dropdown against the **stored** value so a fresh choice could be told from a stale one — needed only while a second control could contradict it. Kept, it would now be **actively wrong**: an ordinary re-save of a Back Next Year customer changes nothing, so it computes false and strips the flag off somebody nobody touched.
   - ⚠ **The stale-dropdown rescue is deleted, not left standing.** It could only fire while two controls could disagree, so it had become dead code that still read as a live rule — and restoring it beside a single control would blank the RSVP of everybody the office brings back in.
   - ⚠ **The check that proved the radio pair existed now proves no second control has returned.** Repointed, never deleted: the state still has to be settable by hand and still has to be loaded when the form opens — only the control changed. `setCustomerSeason` and this save now write the flag and the status together, so they cannot drift.

   ⚠ **THE OFFICE SPOKE THREE VOCABULARIES FOR THREE ANSWERS** (RS-42). The customer presses **Yes / Back Next Year / No**. The office row said *Maybe Next Year* (the **quote's** word), the season chip said *Pending*, and the dropdown said *"No — Skip This Year"* — which is why Addie read it and said *"I noticed there isn't a no"*. All three now match the email. ⚠ **The quote flow keeps Maybe Next Year** — its `approvalStatus`, its response buttons and the Quote Maybe Next Year Follow-up template are untouched. ⚠ **Pending and Unanswered keep their tails** because they are not answers and have no button: they say who has been *asked*.

   ⚠ **TWO PILLS ON ONE ROW WERE USING ONE WORD FOR TWO QUESTIONS** (renamed 2026-09-02). Addie: *"Says yes in one spot but pending in the other."* Both were correct. The **RSVP pill** answers *have they approved* — Yes, because converting from a quote **is** the approval (the *Approved — new this year* badge). The **season pill** answers *are they in the season* — no, because they were blocked by owing $200 from 2025, which the same row spells out underneath. But that pill said **"Pending"**, which is the RSVP vocabulary for *nobody has answered*, so a customer who had approved sat under a chip stating in the other column's own language that they had not. It says **On hold** now.
   - ⚠ **The key is still `pending`.** Only the word changed: `r.badge` is what the season filter matches on and the dropdown's option values are `confirmed`/`pending`/`maybe`, so renaming the key would silently break that filter. The filter's own label already read *"blocked by a rule"* — the chip now agrees with it.
   - ⚠ **A guard stops the collision coming back**: the season cell's chips are read out of the row builder and compared against every word `rsvpStatusLabel` can produce. *Maybe Next Year* is the one deliberate overlap and is excluded by name — it is the same state in both columns, said the same way on purpose.

   ⭐ **AND ON 2026-09-03 THE SECOND PILL WENT ENTIRELY.** Addie, highlighting *"RSVP: Pending"* and *"ON HOLD"* on one row: *"we have two badges or stamps for RSVP we only need the yellow one."* Renaming one of them (above) had not been enough — two pills answering the same question in two vocabularies is unreadable whatever they are called. **The RSVP pill is gone from the All Customers row.** The season badge (Confirmed / On hold / Back Next Year) carries the answer and the hold line under it says *why* — "they said no", "no RSVP yet", "owes $X from 2025" — so a customer who declined still reads **On hold + they said no**.
   - ⚠ **The Unpaid 2025 pill stays.** It was removed in a first pass and put back: it answers *what do they owe*, not *have they replied*, and the two RSVP stamps were what she pointed at.
   - ⭐ **AND THE ROW'S SEASON TOGGLE WENT WITH IT.** Addie: *"I don't know why it shows maybe next year underneath. We can just switch this inside there costumer."* Changing an RSVP now happens in **one place** — Edit Customer's RSVP control — so the list and the form cannot write different answers.
     - ⚠ **Checked before removing it**, because the button did more than set a flag: it called `setCustomerSeason`, which also takes them off upcoming routes. The Edit Customer save does the same on the same transition (`seasonMaybeChosen && !item.data.maybeNextYear`, then `removeCustomerFromUpcomingRoutes`), so **nothing is stranded on a route** by it going.
     - ⚠ **The `maybe` branch lost its Confirm button too**, deliberately — it is the same switch pointing the other way, and leaving one direction on the row would mean somebody can be put out of the season from the list but must be brought back through the form.
     - ⚠ **Confirming still does NOT put anyone back on a route.** That rule survives the button: rebuilding a route behind the office is a worse surprise than re-adding one stop by hand.

   ⚠ **AND THE OFFICE'S OWN BADGE READ AS PENDING** (fixed 2026-09-02). Addie: *"it says pending for RSVP"*, over a card carrying the Maybe Next Year badge. `effectiveRsvpStatus` had `|| dd.maybeNextYear` inside its test and then `return said` — so for a badged customer with no reply of their own it handed back `''`, the very value the line existed to overrule. The office had recorded an answer and every screen called them Pending.
   - ⚠ **It changed no season behaviour, which is why it survived so long.** `isOutForSeason` and `seasonHold` read `maybeNextYear` **directly**, so those customers were correctly off every route the whole time. Only the words were wrong — on the card, the Dashboard counts, and *Owes from last year*.
   - ⚠ **It does not touch who gets the RSVP email.** That audience is `etRsvpAnswered`, which reads the stored `rsvpStatus` and never this function. Checked before changing it, because the RSVP is the one send that has to reach everybody.
   - ⚠ **An existing check asserted the broken behaviour** (`=== ''`) while its own sentence said the real rule — that a bare yes must never come out as an *approval*. Repointed to that intent rather than deleted, and the ordering it was named for is now asserted separately.

   ⚠ **AND NOTHING CHECKED WHAT A BUTTON LEAVES ON THE RECORD.** Every RSVP spec asserted the *call* (`response: 'no'`); the stub's `portalRsvp` never wrote anything, so the half the office actually reads had no coverage on any answer. The stub now writes the same fields the server writes — in the same combinations, because a no and a back next year are deliberately not symmetric — and `test/rsvp-record.spec.js` presses each button and then runs **the office's own badge rule** over whatever the record became.

   ⭐ **A NO GOES STRAIGHT INTO THE PORTAL** (RS-33, 2026-09-01). Addie: *"can no go straight to member portal but will track it even if they don't get to member portal."* ⚠ **This reverses her 2026-08-19 ruling** (*"put a message in front of it first so they know why they've landed there"*), which is kept as the argument against and lived only in a code comment — never a map row, which is the gap R-023 exists to close.
   - ⚠ **The tracking half is not new and must not be broken.** `portalRsvp` runs **before** any navigation, so closing the tab, a portal that will not load, or a dead network cannot cost the answer. The **order** is the whole guarantee, and it is asserted as an order — `portalRsvp` must be the first call — not as "both happened".
   - ⚠ **It fails back, never blank.** If the portal cannot be opened they get the old confirmation and the offer to say why, which is exactly the flow this replaced.

   ⭐ **AND BACK NEXT YEAR IS A POP-UP, NOT A LOADING SCREEN** (RS-34). Addie: *"it looks like a loading page so if they don't read it they might be a little confused."* A tree over one centred line on the page background is what a spinner looks like. It is a white card on a dimmed backdrop now, with a heading saying the answer was recorded — ⚠ **and that heading waits for the write**, because "that's recorded" is a claim: shown early it promises what we do not yet know, shown after a failure it contradicts the error beneath it.

   ⚠ **AND THE BUTTONS ON THESE CARDS WERE WHITE ON WHITE** (fixed 2026-09-01). Addie: *"on computer the do you have gate code comes up far left and it doesn't give you an option you can only choose yes I have one."* `.btn-outline` is `color:#fff` with a translucent white border, built for the dark hero at the top of the site; on the white cards these screens are made of it renders as **nothing at all** — present, sized, laid out, clickable, invisible. It was never one button: the same class sat on *No, I'm All Set*, on both colour-pattern **Clear** buttons, and on **Pay with Venmo** inside the payment dropdown, so the fallback Addie asked to keep as a last resort could not be seen. `.btn-outline-dark` already existed for exactly this.
   - ⚠ **No existing check could have caught it.** Every spec asks whether an element is *visible*, and Playwright's answer is about layout — a white-on-white button is `visible: true`, has a bounding box and takes a click. Colour was the one thing nothing looked at. `test/button-contrast.spec.js` now compares each button's text colour against what is actually painted behind it.
   - ⚠ **And the card sat at the far left**, because `rsvp-minimal` makes `#page-payment` a flex container and its only visible child had no width, so it shrank to its content and settled at flex-start. Measured at 1440px: `x=65, w=584`. The centring is asserted by measurement, not by eye.

   ⚠ **NONE OF THE THREE SHOWS THE INSTALL-DETAILS FORM, and until 2026-08-31 all three did.** The router added `body.quote-minimal` instead — a different class, for the *quote* screens, which force-shows `#page-quote-details` with `!important`. So an existing member pressing Approve was handed the form a brand-new customer fills in (colours, wire, timer), asking again for everything already on their record. ⚠ **The answer was being saved correctly the whole time** — `portalRsvp` ran before any of the UI, and both confirmation messages were built correctly — so nothing anywhere went red and no data was lost or wrong. Only the screen was. That is why it is proved by `test/rsvp-link.spec.js`, which **drives all three links in a real browser**: a source check over `index.html` passes on the broken version, because every message and every handler was present and correct.

   ⭐ **THE TWO TEST BUTTONS MAKE THE TWO KINDS OF CUSTOMER** (2026-09-03, RS-45). Addie:
   *"need to be able to make test person for new person in quotes and costumer for old
   person."* **Quotes → Build Test Customer** makes the **new** one (it comes through a
   quote, so it carries the join); **Customers → Create Test Person** makes the **old**
   one — a returning customer who has not replied, which is what the RSVP can be tried on.

   ⚠ **The stored `rsvpStatus: 'yes'` was what made the test account untestable, and the
   badge hid it.** A bare yes with no `rsvpRespondedAt` is normalised away by
   `effectiveRsvpStatus`, so the row read **Pending** — while `etRsvpAnswered`, which
   decides the send audience, reads the **raw** field and counted it as answered. The one
   record made to test the RSVP was the one record the send would skip, and a send that
   skips somebody looks exactly like a send that worked. It is `'unanswered'` now.

   ⚠ **`'unanswered'`, not blank** — blank means nobody ever asked them, unanswered means
   we asked this season and they have not replied. ⚠ **And they are still routable**: it
   sets no flag and is not `no`, so `isOutForSeason` keeps them in the season.

   ⚠ **A folder a topic is filed into cannot be deleted** (MSG-08). Deleting one files
   what is in it into Inbox, but the topic map goes on naming it — so the next
   cancellation would land in a folder with no row and be in no list at all. It refuses
   before asking, and names the topics that arrive there.

   ⭐ **Customers → Reset Test for RSVP** puts every test record back to that state —
   answer, reply date, Back Next Year badge and new-member tick cleared, nothing else
   touched. Testing the RSVP means testing it three times and watching the badge each
   time, and a reset done by hand between answers is one that gets skipped.

   ⚠ **WAIVING A CARRIED CHARGE WROTE INVOICE FIELDS ONTO THE CUSTOMER** (fixed
   2026-09-03, MON-58). `ledgerWaiveUpdates` had two separate `if`s, so the `else` bound
   to the second and the **carried** ledger fell into it too — writing `creditNotes` and
   `credits` from the carried notes, plus a `status` computed from three undefineds. That
   object goes to `jobAddresses`, so it landed on the customer record. It is an else-if
   chain now and `status` is written only when an invoice is what changed.

   ⚠ **A referral credit is derived, not stored**, which is why it survives: it is a
   `kind:'referral'` line rebuilt on the referrer's invoice, and when there is no invoice
   yet the count stays on the customer and the next save writes it.

   ⭐ **"ON HOLD AFTER I APPROVED" IS THE CONFIRMED-ONLY RULE WANTING A DATE** (2026-09-03,
   RS-47). Addie approved a Test customer through the emailed link and the badge stayed
   **On hold**, with *"Not scheduled — no RSVP yet"* under it.

   ⚠ **The hold was right.** `isOutForSeason` asks for a **dated** reply — `rsvpStatus`
   of `'yes'` with no `rsvpRespondedAt` is the *assumed* yes written when a quote is
   converted, or carried in by an import, and nobody actually answered. A dated yes
   reads **Confirmed**; an undated one reads **On hold**.

   ⚠ **The unpaid bill was not the cause.** The portal's hold reads
   `arrearsOutstanding` — *last* season's debt — so a current bill never touches the
   season badge. Her $946 was this year's.

   ⚠ **And the emailed Yes does work**, bill outstanding or not:
   `test/rsvp-unpaid-this-year.spec.js` drives it in a real browser and the badge goes
   Confirmed. A record still on **On hold** never received that write.

   ⭐ **What was wrong was the sentence.** The line said *"no RSVP yet"* for both states.
   They need different things — nothing on file means chase them, a yes nobody dated
   means confirm it on the record, which stamps the date — so the second now says so.
   It reads the **raw** field, because `effectiveRsvpStatus` normalises a bare yes away
   and that is exactly why the line could not tell them apart.

   ⭐ **THE GATE CODE IS ASKED ON THE WAY PAST A YES** (added 2026-08-31). Addie: *"Lets do gate code before changes."* After the yes is recorded and before *"do you want to make any changes?"*, the customer is asked about their gate code — the RSVP is the one email everybody opens and acts on, so it is the cheapest chance each season to catch a wrong code before a crew is standing at a locked gate.
   - **It confirms a code we already hold, and asks nobody else** (narrowed 2026-09-02, RS-44). A code on file is quoted back (*"We have 4417 as your gate code. Is that still right?"*) with **Yes, that's right** / **It has changed**; confirming writes nothing, so `gateCodeUpdatedAt` marks a real change rather than every RSVP.
   - ⚠ **This line used to say it also ASKED anybody without a code, and that half is gone.** Dax: *"make it so the gate code question after they accept gate code only applys to people that already have a gate code in the system so not everyone is seeing it."* It narrows RS-29 rather than reversing it — the value was always in catching a code that went stale over the summer, and asking the majority, who have no gate at all, a question whose honest answer is *no* was a toll on the way into their own portal. ⚠ **Nothing is lost for the people who now skip it**: gate code is on My Info and on the office record, so somebody who fits a gate later can still tell us. ⚠ **And the early return still hands on to `thenFn`** — that is what raises the arrears pop-up behind it, so skipping the question must never skip what follows it.
   - ⚠ **Only on a yes.** Somebody sitting the season out is never asked — no crew is coming, so it is a question with nothing behind it.
   - ⚠ **It fails open, every way out.** Missing markup, a refused save, a thrown call: all of them move on to the portal (the changes question until 2026-09-01 — see RS-33). The RSVP answer is already recorded by then, so nothing here can cost them their reply, and the same field is reachable any time under My Info.
   - ⚠ **It is NOT `portalSave`, and that WAS the trap.** `gateCode` is in `portalSave`'s `info` whitelist, so reusing it looks clean — and that section used to end `updates.seasonStatus = 'needs_changes'`, the **re-quote state**, resolved by answering a quote. No quote exists here, so every customer who typed a gate code would have sat in Needs Changes for ever. `portalSetGateCode` writes one field and nothing else.
   - ⭐ **That line is gone as of 2026-09-10 (QT-35)** — an info save writes no `seasonStatus` at all now, which is this same argument applied to the whole tab rather than carved around. So the trap is closed on both sides. **The separate callable still stands and must not be folded back in**: it is reached with no sign-in, and it writes exactly one field, so the update call IS the whitelist (`gate-code.test.js` holds that). Folding it into `portalSave` would widen an unauthenticated write for nothing.
   - ⚠ **The browser specs cannot see the server half.** `test/rsvp-gate-code.spec.js` drives the page against a fake Firebase; `gate-code.test.js` holds `functions/index.js`. A red-check proved the split was needed — breaking the real server's return left all ten browser specs green.

   ⚠ **A member is never re-asked for details they already gave.** That rule is the same one behind "an existing member does not get the form" in step 3 above; this was that rule leaking through a different door.

   ⚠ **AND A REMEMBERED SIGN-IN USED TO SWALLOW BACK NEXT YEAR ENTIRELY** (fixed 2026-08-31, the same day and a *separate* bug from the one above). index.html remembers a portal login in `localStorage`, and the block at the top of the file sends anybody who has one straight to `#/payment`. Its test for "are they at the root" was `!initialHash || initialHash === '/'` **with no query test at all**, while `onBarePaymentPage` one line up had always had one. Back Next Year is `#/?token=…&rsvp=back` — its hash *is* `/` — so it was redirected to the member portal.

   ⚠ **The answer was LOST, not just mis-displayed.** The redirect happens before `navigate()` reaches the `rsvp=back` branch, so `handleBackNextYear` never ran and `portalRsvp` was never called. The customer pressed Back Next Year and nothing anywhere recorded it — they stay Unanswered, which under the confirmed-only rule means no crew is wrongly sent, but their intention to return is gone and they sit on the **Waiting on RSVP** call list.

   ⚠ **`handleRsvpLink` calls `savePortalLogin` itself**, so pressing Yes or No on an earlier link *creates* the remembered sign-in that then swallows this one. Testing all three buttons in one browser hits it every time — which is why it survived a fix verified with empty storage. `test/signed-in-links.spec.js` opens every one of these links with a login already saved, because that is the ordinary case and not an edge one.
12. **Recycle** — marking a house recycled in the warehouse clears its `customerNumber` and drops that number back into `availableCustomerNumbers` for reuse (lowest number first).
13. **Colour change** — a house that already has lights up and asks for different ones is neither a build nor a recycle, and since 2026-09-10 it has its own warehouse queue (**Warehouse → Color Change**, [[WH-30]]). `needsColorChange` puts them on it, `colorChangeColors` is a COPY of the colours taken at the moment the change was recognised, and **Mark Done** clears the flag while keeping the colours — they are the only record of what was actually made up.

    ⭐ **Four doors, one list** ([[WH-31]], [[WH-32]]). Dax: *"also make sure anyone who gets a color change is directed there"*, then *"also make sure that if someone manually does their own color change they go there."* The flag is set beside the `lightsChangedVia` stamp at all three sites that already recognise a colour change — the Edit Customer save (`office`) and both portal write paths in functions/index.js (`portal`) — at the **All Customers row panel**, which has its own lights picker and no stamp of any kind, and by a **Color Change** button at the bottom of the customer's record for sending a set over again when nothing about the record is changing. Hung on the button alone it would only ever have been right when somebody remembered to press it, and a customer missing from the list looks exactly like nobody having asked.

    ⚠ **The All Customers panel is the writer that keeps getting left behind.** [[WH-22]] records it being missed once already, when the build-flag rule was fixed in the Edit Customer save and not copied here for five days — one rule, two writers, one repaired. It happened again with this rule. It asks `applyLightChange` what counts as a change rather than comparing the two strings itself, and reads only `isChange`: that rule already refuses a first-time colour and a cleared one, and getting it wrong queues a colour change for somebody filling their colours in for the first time. No fee is written there — that panel has never charged, and the $30 belongs to the Edit Customer save, which asks the office first. The bulk importer and the sheet sync stay excluded ([[WH-21]]): they write hundreds of records a press.

    ⭐ **Print Color Change Sheet** ([[WH-33]]) — numbered from 1, then **#CU**, the name, the colours they want, and a blank column to tick. The number and the tick column come from `whSheetTable`, which puts them on every warehouse sheet, so this one declares neither; #CU is the number on the RECORD rather than `whBinNumberFor`, because nobody is fetching a bin here — a new set is being made up.

    ⚠ **The colours are snapshotted, not read live**, and that is the one way this queue differs from the other two. Build and Recycle both call `houseLightsText(d)` every time they draw, which is right for them — they describe what the house HAS. This is a work order for a set somebody asked to have made up, so a second change must not silently rewrite a job the warehouse had already started.

    ⚠ **`needsColorChange` is not `lightsChangedAt`, though they are set side by side.** `lightsChangedAt` is the FEE and the Excel sheet — it is what sweeps somebody onto the workbook's Color Changes tab and what `applyLightChange` scores a $30 charge from, and it is never cleared because it is history. `needsColorChange` is the shop floor's own list and is cleared by Mark Done. Reading one for the other is how twelve ordinary new customers reached the Color Changes sheet once already.

    ⚠ **The button charges nothing and changes no colours.** The $30 is reached by editing the colour boxes and pressing Save Changes; this only tells the warehouse to make the set up. It also reads the SAVED record rather than the ticked boxes — the boxes may be half-edited and unsaved, and handing the warehouse a set the customer's own record does not agree with is how two screens start disagreeing about one house.

    ⭐ **Fixed in passing:** the three buttons at the bottom of Edit Customer each disable themselves when pressed so they cannot be double-pressed, and **nothing ever re-enabled them** — so queueing a build for one customer left *Build Them A New Set* greyed out for every customer opened afterwards, until the page was reloaded. `openEditCustomerModal` puts all three back. Found while adding the third button, which would have inherited the same bug.

---

## 2. Fields that drive more than one thing

**Measured Feet** (`measuredFeet` on `jobAddresses`) is the single highest-leverage field in the app. One number drives:
- **Bin count**: a house needs another bin for every **320 ft** (⭐ **320 since 2026-09-10** — Addie: *"lets change feet to 320 feet in order to have two bins"*; it was 260 before that). Up to 320 → 1 bin; 321–640 → 2; 641–960 → 3; and so on. More than one bin means a **5000-series** customer number instead of a regular one — there are only two series, so a 3-bin and a 4-bin house both get a 5000 number, while the bin count saved on the customer is the real 3 or 4 so the warehouse builds the right amount. *(Note: older docs call this "the 200 ft rule" and it was 260 until 2026-09-10 — the cutoff in code is `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js, and nothing anywhere should type the number out for itself.)* ⛔ **Raising it does NOT re-count the houses already on the books, and must not.** `numberOfBins` is **stored**, worked out at the moment a footage is saved. A house between **261 and 320 ft** is stored as 2 bins on a 5000-series number and would now work out as 1 bin on a regular one — it keeps what it has until somebody re-saves its footage on purpose. Their bins are labelled and their numbers painted on, so changing them silently would send the warehouse to shelves that do not match the screen.
- **Warehouse bundle count**: `ceil(feet / 40)`.
- **Auto-priced estimate**: `price ≈ feet × perFootRate`, padded ~5% upward, never down.

Changing feet on an existing numbered customer warns before renumbering, rather than silently changing their bin/number out from under them.

**Where Measured Feet comes from — the Measure Roof tool (rewritten 2026-08-27/28).**
You trace the roofline on the **sky view** and nowhere else. Each dot is lettered
A, B, C… and the footage is the distance between them on that one overhead
picture. Street View is for the customer's photograph and for reading a roof's
grade — it does not place a dot and never draws the sky view's.

⭐ **AND YOU CAN FILTER BY IT** (2026-09-01). All Customers → Filters has a
**Season Badge** row — Any / Confirmed / Pending / Back Next Year / **No** — next to
Route Status, because Confirmed *is* the route answer now. The badge is worked
out once per row and the filter and the pill read that same answer, so a filtered
list can never disagree with the badges in it.

⭐ **AND A RECORD STOPS CLAIMING A DAY IT NO LONGER HAS** (2026-09-01). A row was
showing *"Scheduled — Hang Tue, Oct 20"* and *"Not scheduled — no RSVP yet"* one
above the other. The booking fields are stamped when somebody is put on a crew's
sheet and cleared when they are taken off it — but a customer who simply stops
being in the season is never taken off anything, so the stamp outlives the
booking. **Recalculate everything** now clears them and takes the customer off
any upcoming route in the same pass.

⚠ **Install flags only.** A takedown or a fix is work on lights that are already
up, and somebody sitting the season out still needs theirs taking down. ⚠ And
only where there is something to clear — writing false over false on ~950 records
says nothing and stamps `updatedAt` on every one.

⭐ **AND A PLAN ROW THAT IS NOT A CUSTOMER COMES OFF THE SEASON** (2026-09-01).
Measured on the real plan: one customer badged Confirmed, sixteen houses on the
schedule — and the sixteen were rows left over from an imported schedule file,
matching nothing in a book of 956. `customerForHouse` answered null, the *no
record, no opinion* guard kept them, and no Recalculate could shift them. The
season rule was working perfectly; those rows never reached it.

⚠ It is **gated on the customer book having loaded**, which is the half of that
old guard that still holds: `jobAddresses` is empty for a moment after login and
empty again if the listener fails, and an ungated version would wipe the whole
season on a slow morning. ⚠ They are reported separately from the people who
left the season — "somebody said back next year" and "this row is not a person"
need different things from the office.

⭐ **AN RSVP LINK TO TEXT, FOR EVERYONE WITH NO EMAIL** (2026-09-02). The RSVP goes
out by email, so customers with no address on file were never asked at all.
**Automation Emails → Text the RSVP** lists them and hands over a ready message
each — *"Copy their text"* per person, or *"Copy them all for texting"*, one line
per person with the phone first.

⚠ **One short link is the whole RSVP.** `#/payment?token=…` with no rsvp
parameter signs them in, and the first block on that page is *"Are you having
lights this season?"* with all three answers. Nothing new was needed on the
customer's side — the emailed version needs three links only because it *is* the
buttons.

⚠ **The token is keyed to the record, not the phone.** The older
`getOrCreatePortalToken` finds a customer by phone, and seventeen numbers in the
book are shared by two households — through that door the second household's
link would open the first one's portal. ⚠ Who is listed mirrors the email's own
audience, so the two cannot drift about one person; somebody who replied STOP is
shown but has no button, and drawing the list mints no tokens.

⭐ **THE CONFIRMED BADGE IS THE GATE** (2026-08-31). Addie: *"it should look for
anyone who is confirmed and put them in schedule … make sure they cant have the
confirmed tag if they are breaking a rule so if you break one of the rules they
automatically change the badge to pending mainly just the havent paid for last
year"*, and *"you shouldnt have to manually add them to pending"*.

The badge in All Customers has **four** states now — Confirmed, **Pending**,
Back Next Year and **No** — and `seasonBadgeKey` works it out by asking `isOutForSeason`
rather than deciding for itself. So **Confirmed and in-the-season are one fact**:
no row can read Confirmed while every scheduler in the app has already dropped
that customer.

⭐ **AND FROM 2026-09-04 THE PLAN ACTUALLY KEEPS THAT PROMISE** (SCH-48). Addie:
*"in schedule some people are confirmed but still arent in schedule and I dont know why
… if anyone has a confirmed tag they should be scheduled somehow no exceptions."* The
sentence above was written as a design intent and the schedule broke it three ways, every
one of them silent: a `needsLightBuild` gate with no clock in it (§2b), a hold spelled as
absence rather than as a later first day (§2b), and `seasonCustomerIds` resolving a plan
house by **customer number** — which is recycled and reissued, and first-match-wins — so a
house carrying a stale number resolved to its new holder, who then read as *already on a
day* and was never added. The schedule resolves through `planCustomerFor` now: the
`cust-<docId>` id first, `customerForHouse` only as the fall-back for imported CSV rows.
⚠ **That fall-back still resolves an imported row by its stale number**, and always will
— those rows carry no id to read. Said out loud rather than left as a silent gap.
⚠ **And the promise is checked out loud.** `confirmedNotOnAnyDay` asks `seasonBadgeKey`
— the badge the office actually reads, not the rule behind it — and *Recalculate
everything* **names** anybody it finds. It should never fire, and it reports rather than
repairs: a checker that quietly added whoever it found would hide the rule that dropped
them, which is how this went unnoticed for a fortnight. Pending is derived and never stored, so paying the bill moves the
badge on its own the next time the row is drawn. ⚠ Back Next Year stays its own
answer rather than folding into Pending — that one the office sets by hand.

⭐ **AND "NO" IS ITS OWN BADGE TOO** (2026-09-04, RS-49). Addie: *"when they click no
they go to maybe next year but actually we want them to just go to no for the badge in
case we want to send two different emails for each."* The two answers were always stored
apart — `portalRsvp` writes `no` or `backnextyear`, and the Email Tool's RSVP filter has
always offered them as separate audiences — but `seasonBadgeKey` folded them together, so
one yellow chip covered two different decisions and the badge could not be used to pick
between them. ⚠ **Nothing about the season moved**: `isOutForSeason` is untouched, so
somebody who said no is out exactly as before, off the routes, the schedule and the build
queue. Only the word on the chip and the value the Season Badge filter matches changed.
⚠ **The customer's own latest word wins over the office flag** — `maybeNextYear` is only
ever written alongside `backnextyear`, so holding the flag while reading `no` means they
answered no afterwards, and that is the rule `isOutForSeason` already states.

⚠ **And an unanswered RSVP decides again — Pending is what carries it.** For a few
hours it did not: the rule was turned off, which made the badge honest by scheduling
everybody. Addie, looking at the result: *"anyone who is confirmed is scheduled but
if one person is confirmed there should be one person on the schedule."* The
complaint was never "schedule everybody" — it was that a row said Confirmed while
every scheduler had dropped that customer. With the badge able to say **Pending**,
the rule can stay on and the badge still tells the truth: today one customer has
actually replied Yes, so **one** is Confirmed and **one** is scheduled, and the ~951
who have not replied read *Pending — no RSVP yet*.

⚠ Worth knowing, because it caused the confusion: **a test send stamps `rsvpSentAt`**
exactly as a real one does, and that marker is what arms the rule. Measured before
any of this: 956 customers, 951 held out for no RSVP, 2 for owing from 2025, 1 back
next year, 1 scheduled.

⭐ **ALL CUSTOMERS TAGS WHO STILL OWES FOR AN EARLIER SEASON** (2026-08-31).
Owner: *"we need a seperate tag for people who havent paid for 2025 can you just
add another one under the same badge that says unpaid 2025."* Under the
Confirmed / Maybe Next Year badge there is now a red **Unpaid 2025** tag on
anybody whose last-season balance is still outstanding.

⚠ **The year is ASSUMED to be 2025, everywhere** (changed the same day, at her
instruction: *"assume if they havent paid for a previous season its always
2025"*, then *"so it assumes 2025 season and adjust everything youve done to be
centered around that"*). One constant, `ARREARS_ASSUMED_SEASON`, governs the
badge, the **Which season** box in Edit Customer — which now opens on 2025
rather than blank — and what a blank box saves, so the debt itself carries the
year rather than the badge guessing over it. A season somebody typed is never
overwritten. ⚠ The cost, taken knowingly: a debt carried out of THIS season is a
2026 debt and will still read 2025 until that one line is moved.

⚠ **The amount is suggested, not filled in.** *"by default assume they owe the
same for this season as last season"* — so the box shows this season's price in
grey with a **Same as this season** button beside it. It is deliberately not a
real value: a filled-in amount would mean every ordinary save of any customer,
opened to fix a phone number, wrote a debt of their whole year's price onto them
and held them off the schedule until it was paid.

⛔ **What this replaced,** kept because it is the argument for MOVING the
constant rather than for reinstating the derivation: the tag used to read the
year off the debt, so it stayed right when a season turned, and a debt with no
year recorded read “Unpaid last season”. That last wording was the ambiguity
she was objecting to.

⚠ It is judged by **the bill the house is actually on**, so a tenant billed to a
landlord is tagged from the landlord's bill — the tag and the "owes $X from
2025" line in the Route column read the same helper and cannot disagree. It
shows on the Maybe Next Year rows as well: somebody sitting the season out who
still owes for the last one is exactly who has to be rung.

⭐ **AND OPENING THE TOOL FORGETS THE LAST HOUSE** (2026-08-31). Owner, on a
quote she had not started measuring: *"A – B 0 ft across … E – F 0 ft across …
I – J 0 ft across … this is there before i even start measuring."*

⚠ **On a page left open from before the fix above, that is the fix not being
loaded** — the dots and peaks now clear together, so "peaks present, dots gone"
cannot happen on the current file. A hard refresh (Ctrl+Shift+R) is the answer.

⚠ **But there was a second path, and it is closed.** `rmReset` — what runs when
the tool opens on a quote — resets a dozen per-house things by hand, and the
dots and the peaks were not among them. The only thing emptying them was the
address load, which happens a tick later and only when the quote HAS an
address. So the previous house's marks sat on screen while the map loaded, and
on an address-less quote they stayed, putting that house's footage into this
one's price. `rmReset` now calls **`rmForgetLastHouse`**, which is the one
function that knows what belongs to a house.

⭐ **A PEAK SURVIVES THE PAGE BEING LEFT** (2026-08-30). Owner: *"the peaks are
not adding anything because i left the page then came back, but the dots are
still there so it should've included the peak addition into the price but it
didnt."* A peak is a pair of corner NUMBERS, and the corners were never saved —
only the traced runs were. So reopening a quote put the lines back on the map,
which made the dots look present, while the corner list came back empty and
every peak measured a span of nought. The pitch she had taken was still on the
row, so each peak showed its angle beside no span and added nothing to the
price.

⚠ **The peaks were cleared nowhere at all**, which is the worse half: a gable
measured on one roof stayed in the list when the tool opened on the next one,
pointing at corner numbers that by then meant somebody else's dots.

What is true now: the dots and the peaks are written into the saved drawing and
put back before anything reads a total; a peak whose corners did not come back
is **dropped** rather than listed spanning nothing; the peaks are emptied
everywhere the dots are; and taking a dot back off drops the peak on it and
shifts the rest down, instead of silently re-hanging a gable between two
different corners. ⚠ A run built from the corners is **rebuilt** from them on
the way back in rather than restored beside them — restoring both puts the same
footage on the price twice.

⭐ **THE PICTURE ON THE QUOTE IS THE STREET VIEW** (2026-08-30). Owner: *"when you
dot the sky view the picture of that gets uploaded as well but we just want the
street view to be uploaded."* Attach used to work out which pane she meant from
where the marks were — and since the roofline is traced overhead and nowhere
else, that answered *the aerial* for every house measured properly. ⚠ The sky
view is where the house is MEASURED; the street view is the PICTURE, which is
the same line she drew on 2026-08-28 when she said the street picture must not
show the sky view's dots.

⚠ **Capture Sky View is gone.** Its only job was to put a picture on a quote.
The sky view itself is untouched — it simply is not a picture source. ⚠ An
aerial still reaches a quote in one case only, where Google has no street
photograph of the address at all, and then the picture's own label says so.

⭐ **BOTH PICTURES AT ONCE, HALF AND HALF** (2026-08-30). A third button in the
sky view's top corner — ◫, beside Recentre and Full screen — gives the whole
screen to the PAIR: the map on one side, the photograph on the other, 50/50.
Placing a corner needs both, big; full-screening one pane takes the other away,
and leaving full screen gives them back at a couple of hundred pixels each.
⚠ Pressed while one pane is already full screen it swaps straight over; pressed
again it comes back out. On a tall narrow screen the two stack rather than
squeeze into 200px columns.

⭐ **AND A PITCH IS SAID IN DEGREES FIRST** (2026-08-30). Owner, on a peak the
tool reported at 49%: *"does this math add up to you because it doesnt to me"*,
then *"i think it did the math as if its a 4 degree angle not 49 or something"*.
⚠ THE SUM WAS RIGHT AND WAS NOT CHANGED. 49% grade IS 26.1°, and 26.1° across a
24.7 ft span really does add 2.81 ft — but a bare "49" beside a roof reads as
forty-nine DEGREES, which would have added 12.95 ft. So every figure that could
be mistaken for an angle now leads with the actual angle, the percentage is
called a *grade* where it still appears, and the note after **Yes, use it** shows
its working: the slope runs 27.6 ft across a 24.7 ft span, so +2.9 ft. A number
that sets a price has to be checkable by the person reading it.

⭐ **A peak's pitch is measured in the WORLD, or simply typed** (2026-08-30). A
24 ft gable at 45° adds 9.94 ft — two rakes of 12 / cos 45 instead of a flat 24 —
and that is what the tool now gives. It was giving less, and the formula was never
the problem: the drag measured rise over run **in screen pixels**, and the grade
panorama is aimed UP at the roof, which compresses the apparent slope of anything
above the camera. Always too shallow, so a true 45° rake read back as 87–94%.

Each dragged pixel is now a ray intersected with the **gable's own vertical plane**
— the two dots that name the peak already define it — so the answer stops
depending on where the camera stood or which way it was pointing. ⚠ The old pixel
reading is kept as the fallback for a gable seen end-on, and the tool SAYS when
that is what you are looking at.

⭐ **Or type it.** Each peak row has a pitch box: **45** (degrees), **12/12**, or
**100%**. A typed angle carries no projection error at all. ⚠ A peak with no pitch
of its own says **(roof average)** beside its figure rather than showing Google's
whole-house average as though it were this gable's.

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
same inflated figure sizes the bins, picks the number series and counts the
bundles at 40 ft, so a 285 ft house is filed as 328 and can be given a second bin
and a 5000-series number it does not need. (The bin cutoff is `CN_DOUBLE_BIN_FEET`
— 320 since 2026-09-10, 260 before that — so the pair of numbers that lands a
house the wrong side of it moves whenever the constant does.) Dropping the dial from 1.3 to 1.15
narrowed that; it did not remove it. The clean fix is to store the true footage
and apply the multiplier to the MONEY only — offered, not yet decided.

⭐ **Recentre is reachable in full screen** (2026-08-30). It already existed in the
toolbar and already worked — but full screen is requested on the PANE, so the
toolbar is simply not on the glass, and losing the house is exactly what happens
when somebody is zoomed in and full screen. There is a second Recentre inside the
sky pane's own head, beside the full-screen button. ⚠ **One function, two doors**:
`rmRecentre` is at module level and both buttons call it, because a second copy of
"put the camera back" is the copy that stops matching. It frames what has been
traced when there are dots down, falls back to the house otherwise, re-aims Street
View, and takes the covers off — so it is also the way out of a stuck pane. ⚠ It
changes **no measurement at all**, which is what makes it safe to sit where a thumb
can find it by accident.

⭐ **How big a mark is, and what happens on a dormer** (2026-08-30). Every mark
size is one named constant — `RM_DOT_R`, `RM_SKY_DOT`, `RM_LINE_W` and their
neighbours near `rmCornerMarkers` — because FOUR things draw these marks (the
street overlay, the sky markers, a traced run's handles, and the fallback
picture) and separately tuned numbers are how two views start disagreeing about
how big a dot is. They are deliberately small: a dormer's edges are a few feet
long, so a dot comfortable on a long eave is wider than the edge it is marking.

⚠ **The labels thin themselves out; the dots never do.** Where marks are packed
closer than `RM_LABEL_GAP` on screen, the ones whose number or letter would land
on top of another are drawn without it — every dot still shows. **Zoom in and the
letters come back**, because it is the picture that is crowded, not the roof. A
letter is hidden at that magnification, never taken away. If the map cannot say
how far apart things are, every label is drawn — the safe direction.

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


**One press of Attach to Quote finishes the job** (2026-08-29). It takes the
picture, puts it on the quote, writes the footage and the price onto that quote
and onto the customer behind it where there is one, and closes the tool.

⚠ **It used to be able to do nothing at all.** Attach could only upload what
*Add to Quote List* had already staged, so it sat DISABLED under a house that
had just been measured — and a greyed-out button reading "Attach to Quote" is
indistinguishable from a broken one. Nothing staged is now a reason to TAKE the
picture: it captures whichever view you were last working in and attaches that.

**Your dots go on the picture, and the box is TICKED to start with** (2026-08-30 —
the first version drew them and left the box unticked, so the clean copy is what
got attached and the dots were still missing). The marks are drawn onto a capture — the street
view's numbered marks and the sky view's lettered corners, joined per strand,
with any run you switched off left out because nobody is going to hang it.
⚠ The photograph underneath is still kept CLEAN. Two copies are attached: the
marked one is what shows, the untouched one is the photo's `original`, and the
marks also ride along as ordinary markup shapes. So Mark Up This Photo → Clear
→ Save gives the clean house back, which is what keeps the 2026-08-25 rule
(*"I don't want red lines showing here after I'm done measuring"*) true at the
same time as the dots travelling with the picture.

**And the numbers reach the customer.** The same press writes `estimatedFeet`
and `quotedPrice` onto the quote — the *Save to this quote* block still exists
and still does only that — and then, when the quote carries a
`convertedToCustomerId` or `existingCustomerId`, it writes `measuredFeet`,
`housePrice` and `numberOfBins` onto that customer and re-sums their bill
through `syncPayerInvoice` (the payer's bill, if the house bills to somebody
else). ⚠ A quote that is not yet a customer writes to no customer at all: its
feet and price already carry across on conversion, and guessing a customer by
name or phone is how a book gets duplicates in it. ⚠ And the customer NUMBER is
never rewritten — a number already given out is on a bin in the warehouse, so
the tool says the series no longer matches the footage and leaves it to a
person. Suite 282.

⭐ **The picture is a PHOTOGRAPH OF THE SCREEN** (2026-08-30). Press Capture, or
press Attach with nothing captured, and Chrome asks **once a session** whether this
tab may be photographed; from then on every capture is a frame of the pane
exactly as it appears — the dots, their numbers, the joined strands, the letters,
all of it. Nothing is downloaded: the frame goes onto a canvas and straight to
Cloudinary.

⚠ **There is no way to allow that question permanently, and it is not an
oversight.** Chrome has no site permission for screen capture, because a page
that could photograph itself unasked could photograph whatever else is in the
tab. So the answer is kept for as long as the admin page is open — one ask covers
a morning of quotes — and Chrome's own **Stop sharing** button is the way out of
it: pressing it means the next capture simply asks again. Nothing is ever shared
until a capture is actually pressed.

⭐ **There is now a way to skip the question entirely, and it is a separate
browser** (2026-08-30, at her request after the trade was spelled out). **Highlighting
Utah Admin.bat** on the Desktop opens Chrome with its own profile
(`C:\Users\lanil\HLU-Admin-Chrome`) and the `--auto-accept-this-tab-capture`
flag, so captures happen with no prompt at all. ⚠ **That browser can photograph
its own tab without asking, whatever site is open in it** — the flag belongs to
the whole browser and cannot be limited to one address, which is exactly why it
lives in a profile that only ever opens the admin. Her everyday Chrome is
untouched and still asks. ⚠ It also HAD to be its own profile to work at all:
one Chrome process serves every profile on this machine, so flags on a shortcut
are ignored whenever Chrome is already running. Nothing in the page changed —
the admin works the same in either browser, one just stops asking.

⚠ **This is why three earlier fixes did not land the dots on the house.** Every
version before it FETCHED A FRESH PHOTOGRAPH from Google and re-drew the marks
onto it from the directions they are stored as, so the dots were only ever as
right as the arithmetic lining that new photograph up with the one on screen.
Panorama, heading, pitch, field of view, aspect — any one of them off by a little
and the marks sit beside the house. There is nothing to line up if the picture is
the screen.

⚠ **A screenshot has no clean twin, and that is the trade.** A fetched photograph
could be uploaded twice, clean and marked, because we drew the marks. The marks
in a screenshot were on the glass. So the marked picture IS the picture, the
markup shapes are not offered (they would draw every line a second time), and
Replace This One is how it is undone.

⚠ **The fetched path is still there**, for a browser that will not share — and it
says so, and says the dots on that one are worth checking. What follows describes
that fallback.

**And the fallback picture is the same photograph the dots were placed on.** The street
capture is asked for by **panorama id**, not by position: `location=` makes the
static service go and find the nearest panorama, and the arrow keys walk between
panoramas — a mark is a *direction from one camera* and means nothing from the
next one down the street. It also asks for a field of view the service can
actually give (it caps at 120° and does not say so, so a zoomed-out pane used to
get a 120° photograph with every mark laid out for 180°), and the crop carries the
zoom that MEANS that fov, so the drawing and the photograph cannot be told two
different things.

⚠ **And a picture with none of your marks on it says so.** The crop screen counts
them the moment the picture appears — *"2 of 3 dots on this picture"*, or *"None of
your 3 dots landed on this picture — it is aimed somewhere else"*. A capture with
the marks switched off and a capture whose marks all fell outside the frame look
identical, and neither said a word; that silence is what let the missing dots
survive a fix. Attach names it in its toast too.

⚠ **Attach captures the view the marks are IN**, not merely the one last touched —
`rmLastPane` moves on a plain mousedown on the satellite map, so nudging it after
dotting a front elevation was enough to attach a picture of the roof from above
and none of the dots.

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

⭐ **WHEN A BILL IS DUE, AND WHAT HAPPENS IF IT IS NOT PAID** (changed 2026-09-11).
Addie: *"everyone still receives there invoice after they get installed but now they have
until february to get them paid. We will give them one text reminder at the end of
February than if they don't respond by end of March than they will get a fee email at
beginning of April"*, and on the text: *"Feb 1 is when we will send out Text messages and
need to be reminded on Feb 1st to send those out to everyone that hasn't paid as a pop up
on admin portal on feb 1st."*

Four dates, and they belong to the **season**, not to the house:

| | When | What happens | Who does it |
|---|---|---|---|
| **Invoice** | the night their lights go up | emailed automatically, 7 PM | the system |
| **Due** | **last day of February** | printed on the invoice and on the email | — |
| **Text** | **1 February** | a pop-up lists everybody who has not paid, with their phone numbers | **the office texts them** |
| **Fee** | **1 April** | $25 if they have paid something, $40 if nothing, added to the bill and emailed with it | the system, *if switched on* |

⭐ **THIS REPLACED A ROLLING 30-DAY CLOCK, and that is the whole of the change.** Terms
used to run 30 days from the invoice date, so every house had its own private due date and
its own private chase days: a house done on 3 October was chased in November while its
neighbour done on 20 December was chased in January. The office now has two days in the
year to think about rather than nine hundred.

- ⚠ **The text comes BEFORE the due date, on purpose.** Asked whether the paper should say
  1 February to match the text, Addie chose *Feb 28 on paper, text Feb 1* — so the text is
  a reminder that the month to pay has started, not a chase for a bill already late.
- ⚠ **"If they don't respond" means they have not PAID.** Asked directly, she chose *they
  haven't paid in full* over *they never replied*. There is no "they answered" flag
  anywhere in it and there must not be one: a reply is not a payment.
- ⚠ **Which February is decided by the SEASON, not the year on the invoice.** A bill issued
  in January belongs to the autumn just gone and is due weeks later — reading the issue
  year alone would give that house fourteen months. July is the split.
- ⚠ **Overdue now means past the date on their own invoice**, and the red card waits until
  1 April. Both used to count days from the invoice, which under February terms would have
  flagged the whole book in November and reddened it in December while nobody was late.
- ⚠ **One rule, two copies**, `invoiceDueDate` in `js/money.js` and `invoiceDueDateServer`
  in `functions/index.js`, swept by `money-parity.test.js` over 144 issue dates — the
  server's is what stamps the date the customer actually reads.
- ⛔ **The April send is the only thing in the app that charges a customer with nobody
  pressing anything, and it ships switched OFF.** `settings/lateFeeAutomation`, with a
  *Check first* dry run beside the switch in Invoices > Nightly Automation, and checklist
  row 222 to read that list against the real book before it is ever turned on. It skips
  anybody already charged, anybody paid in full, and anybody whose only outstanding amount
  is a balance carried from an earlier season (**Q-034**, open — that last one is a default
  rather than her ruling).
- ⚠ **"Anybody already charged" means already charged THIS season, and Start New Season is
  what makes that true.** The marker (`lateFeeAt`) lives on the invoice, and invoices are
  reused season to season rather than recreated — so the season reset clears it along with
  the deposit, the credits and the issue date. Left standing it would stop being a
  once-a-season guard and become a once-for-ever one: charged in April 2027, then silently
  skipped every April after that, for that customer, permanently. That is the
  `chargeNewMemberFee` failure with its sign flipped, and the quiet direction of it —
  nobody ever rings up to say they were *not* charged. Suite 325 holds it.

**The one correct formula, everywhere:**
```
owed = (install + removal + changeFees) − credits − deposit, floored at 0
```
This lives as `computeInvoiceStatus(install, removal, deposit, credits, changeFees)` in admin.html and is mirrored server-side in `functions/index.js`. As of this pass, every place in the app that computes a balance or status uses the full formula — that was **not** true before this pass (see the P0 fix in git history: `changeFees` had been left out of roughly 15 different call sites, including the actual PayPal charge amount).

⭐ **AND THE FIGURE THE OFFICE SCREENS PRINT IS ITS OWN NAMED RULE** (2026-09-08). Dax:
*"it said $956.00 before and after i added a discount so i dont know if its just not
working but it should say $950 after the discount everywhere"*, and *"if its a fee the
other way where it adds to everything"*.

```
billTotalAmount(d) = (install + removal + changeFees) − credits, floored at 0
balanceDueAmount(d) = billTotalAmount(d) − deposit, floored at 0
```

The discount **had** saved — the invoice held `credits: 6` and the balance really was
$950 — and every figure the CUSTOMER ever sees was right: PayPal charged $950, the
emailed invoice showed the discount as its own line, the portal balance was $950. What
was wrong was four **office** screens, each of which built a total by hand out of
`install + removal` (and sometimes `+ changeFees`) and never subtracted `credits`:
the Invoices row's *Amount*, the customer row's *Price*, the All Customers table's
invoice cell, and the *Invoice Total* column of the All Customers export.

⚠ **They all drifted the same way because nothing could see them.** money-parity.test.js
sweeps every site that works out an amount and compares it against `balanceDueAmount`,
but it lifts each one by slicing a **named statement** out of the source — and all four
of these were written inline inside an HTML template string, which cannot be sliced. So
the four screens that printed money to the office were the four the guard was blind to.
Giving the figure a NAME is the fix; the check is a consequence of it.

⚠ **The deposit is deliberately not in `billTotalAmount`.** The Invoices row prints
*Amount*, *Paid so far* and *Balance* on one line; a deposit inside the first of those
takes the payment off twice and the three figures stop adding up.

⚠ **The two are written out in full rather than one calling the other**, because both are
lifted BY NAME and compiled ALONE by money-parity and arrears-hold — a call to a sibling
there is a ReferenceError inside the harness that guards them. They are held together by
a check that RUNS both over the same 13,068 records instead.

⭐ **EVERY FEE AND DISCOUNT IS ON THEIR ACCOUNT, AND EVERY ONE CAN BE WAIVED**
(2026-09-03). Edit Customer lists them as lines with a ✕ each: the fees on the
invoice, the discounts, and — new — **charges carried to next season**.

⚠ **That last one is where a portal colour change was disappearing.** Where the
fee goes depends on whether the bill has already been sent: unsent, it is a line
on the invoice; already sent, it becomes `carryoverCharge` on the CUSTOMER, to be
collected next season. Edit Customer's fee lines only ever read the invoice, so
the second kind was invisible on the one screen anybody would waive it from.

⚠ It is the only ledger whose money lives on the customer rather than the invoice,
so its ✕ writes to `jobAddresses` — but the plan is built by the same shared rule
as the other two, because a second copy of "drop this line and re-total" is how
one ledger starts disagreeing about what a ✕ does. ⚠ And it is never refused for
want of an invoice: it exists precisely because the bill had already gone out.

⛔ **AND FOR FOUR DAYS THE LINES WERE NOT LISTED AT ALL** (found and fixed 2026-09-07,
MON-66). Dax: *"disounts and fees should be listed in a customers account but right now
the fees and discounts arent being listed and when it is listed we should also have a
way to delete it."* Three faults, and the first one hit every customer in the book.

- ⛔ **`editCustInvoiceNow` ANSWERED `null` FOR EVERYBODY.** It handed the customer
  RECORD to `allCustInvoiceFor`, which wants the address ITEM and asks
  `custInvoiceKey(item.data)` — so it keyed on the empty string, every time. Every
  caller therefore drew an EMPTY ledger: cross one fee off and the redraw blanked the
  fee list **and** the discount list, so a ✕ that had genuinely worked looked like it
  had deleted everything. Nothing threw. Every check on it read the code as text and
  passed; only calling it can see this, which is why suite 309 now RUNS it.
- ⚠ **THE LIST AND THE ✕ DISAGREED ABOUT WHICH BILL.** The ✕ was taught on 2026-09-07
  to resolve `billToPhone` first; the LIST was left on the house's own key. A house
  billed to somebody else has no invoice of its own, so it listed nothing while the ✕
  pointed at the group's bill. One resolver now — `editCustInvoiceNow` — read by the
  lines, the ✕, its redraw and the carried-debt summary.
- ⛔ **A FEE TYPED ONTO A CUSTOMER WITH NO BILL WAS THROWN AWAY SILENTLY.** Every
  ledger line lives on the invoice, and both no-invoice branches of the save write it
  nowhere: no throw, no toast, a green *Saved*, and an empty Fees box on reopening.
  **It now makes the bill** (MON-67, same day — Dax: *"minting the invoice feel free to
  do that"*). The seed is built in memory and handed to the SAME rebuild the
  existing-invoice branch runs, so the typed lines are placed by one rule and the whole
  document lands in **one `setDoc`** — two awaited writes can half-succeed, and the half
  that survives would be an empty bill with the fee still lost. ⚠ Only when a ledger line
  was actually typed: minting on every save of an un-invoiced customer would put a $0
  bill on people nobody has priced yet, and the price-only path still owns that case.
  One live customer is affected today (956 customers, 935 invoices), so this is a guard
  against a silent loss rather than a fix for a backlog.

⭐ **AND THE CARRIED DEBT HAS AN ✕ NOW TOO** (2026-09-07, MON-67 — Dax: *"make the arrear
line have an x"*). ⚠ **THIS REVERSES MON-55, WHICH CAME FROM ADDIE'S OWN MON-38**, and the
old reasoning is kept because it is exactly what the new prompt carries: `arrearsOutstanding`
is the **only** thing holding an unpaid customer off the schedule, so crossing that line off
IS the *"hang them anyway"* button she was offered and turned down. There is no version of
it that isn't — the hold is derived from the debt and nothing else.

⭐ **What changed is that it can no longer happen silently**, which is the harm MON-55
actually recorded: the button it was written against wrote off a real debt *and* released
the hold, from a control labelled "remove light-change fee". ⚠ It lives in the shared
write, **not** in either click handler — the Invoices panel and Edit Customer both come
through it, and a copy in one of them is an ✕ that asks on one screen and not the other
about the same money.

⭐ **IT IS ONE PRESS, THE SAME AS EVERY OTHER LINE** (MON-69). It briefly asked the office
to type the amount (MON-68, superseded the same day); Dax: *"Make it one press like the
others — I'd keep the Inbox note either way, so a wrong one is still findable and
reversible"*, and, on what the ✕ is for at all, *"the x is if we want to get rid of a fee
or discount on someones profile"*. ⚠ **The risk MON-68 named has not gone away** — there is
**$7,487.04** across the 19 rows carrying a carried debt, and crossing one off releases the
schedule hold with it. What changed is which side of the trade is paid for: a row that
argues back is a row the office learns to work around, on a control pressed in the ordinary
run of tidying a bill.

⭐ **And a written-off debt leaves a record — which is now the WHOLE of the protection**,
and is what makes a bad press survivable.
Waiving DELETES the line from `changeFeeNotes`, so without this there is no trace anywhere
that the money was ever owed — the same asymmetry this file already names, a charge leaving
a dated line and a waiver leaving nothing. A **Carried Debt Written Off** notice lands in
the Inbox's *money* section carrying the amount, the season and the reason: everything
needed to type it back into *Owed from a previous season*. ⚠ Only the carried debt gets
one — a light-change fee or a discount coming off is ordinary office work, and a note for
each would bury this one. ⚠ A failed note never undoes the write-off; the money is off the
bill by then, so it is logged rather than thrown.

⭐ **AND THE ✕ HAD TO EMPTY THE BOX THAT REBUILDS THE LINE** (fixed 2026-09-08). Dax:
*"the x in arrears in discount and fees doesnt work."* It did work — for about as long as
it took to press Save. In **Edit Customer** the ✕ on a manual fee, a manual discount and a
referral credit each empties the box above that would otherwise write that line back on
save; the carried debt is rebuilt exactly the same way, from *Owed from a previous
season*, and it was the one never added to that list. So the sequence was: press ✕, the
line comes off the invoice, the row says *“Took $400 off — saved.”*, then press Save —
which is why somebody is in that form at all — and the debt is written straight back
**with the schedule hold on it**, from a screen that had just said it was gone.
  - ⚠ **Keyed on the KIND, not on `source`.** The automatic line Start New Season writes
    needs no clearing, because no box holds it — but keying the ✕ on `source` would be a
    second place that has to agree with the save's filter about which lines that box owns.
  - ⚠ **The season box goes back to the assumed season**, not to whatever named the debt
    that just went: a box left reading 2024 is the next debt typed there silently landing
    in 2024.
  - ⚠ **The figure under the box is redrawn from the invoice** after any waive. It went
    stale for the automatic line too — still reading *“$400 carried by the app”* over a
    bill that no longer carried it — and no box branch could ever have fixed that one.

⚠ `ledgerLineIsWaivable` is a blanket yes now rather than a whitelist — a whitelist fails
silently, leaving whatever is invented next with no ✕ and a screen that looks like nobody
was charged. It is still the write-side guard, and **fee-waive.test.js §6 runs the renderer
and the write over every kind and fails if they disagree**, so a protection reintroduced
later cannot draw an ✕ the write refuses.

⚠ **`allCustInvoiceFor` IS UNTOUCHED AND MUST STAY NARROW** — it answers "the invoice
filed under this HOUSE'S OWN key", and the Edit Customer save calls it directly to find
and zero a leftover when somebody starts billing elsewhere. The guard written for that
on 2026-09-07 named `editCustInvoiceNow` instead, which the save has never called; it is
repointed to the function that actually carries the rule. ⚠ And the boxes above the
lines still read `ecInv`, the house's own invoice, because the save rebuilds the manual
fee and discount FROM those boxes — filling them from a group's bill would copy one
household's fee onto another on the next press.

**Two separate fees, easy to conflate — the set-up fee is $30, the light-change fee
is $30.** The set-up one moved to $25 on 2026-09-03 (*"make the set up fee $25"*) and
back to **$30 on 2026-09-07** — Dax: *"we need to change the instalation fee to $30."*
They are separate charges: a new member who changes their colours late pays both.

⭐ **AND THE CUSTOMER-FACING NAME IS THE INSTALLATION FEE.** That is what the invoice
document, the invoice email and the quote all call it; "new member fee" is only the
field name (`newMemberFeeApplied`, `NEW_MEMBER_FEE`). Worth knowing before searching
for it — asking the code for "installation fee" finds the wording, not the constant.

⛔ **THE NIGHTLY INVOICE HAD THE FIGURE TYPED INTO IT, AND IT DISAGREED WITH THE
CHARGE** (found and fixed 2026-09-07, while making the change above). `functions/index.js`
built the line as the literal string `'Installation fee = $30.00'` while the fee itself
was `NEW_MEMBER_FEE = 25` and admin.html's copy of the same email rendered
`fmtMoney(NEW_MEMBER_FEE)`. So for every new member the **automatic** invoice email said
$30.00 and the bill charged $25 — its own line items did not add up to its own total —
while a **hand-sent** invoice for the same customer said $25.00. Two renderers, one
email, one of them holding a number by hand: the `{{photo}}` shape, in the one place
where it is money on a customer's bill. It reads the constant now. ⚠ Nothing went red
for this, because no check compared the two renderers' wording — only the two copies of
the *constant*, which agreed with each other the whole time.
is also $30, and that is a coincidence, not one shared number.** She moved the set-up
one to $25 on 2026-09-03 (*"make the set up fee $25"*), then reversed that on
2026-09-06 (*"That should be 30 dollars not 25 for insalation"*) — back to where it
started. They remain separate charges with separate names: a new member who changes
their colours late pays both, and a future change to one must not touch the other
just because they currently print the same number.

⚠ **The set-up fee is one number in one place now** — `NEW_MEMBER_FEE`, in
`js/money.js` and mirrored in `functions/index.js` because the server cannot import
a browser module. `money-parity.test.js` fails the build the moment the two differ,
which is the thing that matters: the office quoting one figure while the nightly run
charges another. Every sentence that prints it reads it, the invoice line and the
emailed one included. It used to be a bare `30` in twelve places.

⚠ **An invoice already carrying the old fee is recomputed to the new one** the next
time it syncs — one price for the season. The exception is Start New Season, which
*strips* the fee rather than recomputing, so an invoice written under the previous
figure is out by the difference in whichever direction the fee last moved — it has now
moved twice ($30 → $25 → $30), so this is not a one-off. That is written down at the
line rather than fixed, because the fix is storing the amount on the invoice when it is
charged, and until that exists every change to this number leaves a tail behind it.

**The two, in detail:**
- **New-member fee** — added once by the nightly Cloud Function for a customer's first season, flagged `newMemberFeeApplied` so it's never double-charged. It's folded directly into `install`, not tracked as a separate line.
- **Light-change fee** (`changeFees`, with itemized `changeFeeNotes`) — added by `portalSave` when a member changes their light colors outside a 48-hour grace window. Tracked as its own field, separate from `install`, so it can be waived independently — see the × below.

⭐ **THE × TAKES A LINE OFF THE BILL THE CUSTOMER IS ACTUALLY ON** (fixed 2026-09-07, MON-64).
Dax: *"when i try to delete a discount or fee it says they dont have a invoice, and everyone
should have a invoice and it should delete."* The × resolved the invoice through
`allCustInvoiceFor`, which answers *"the invoice filed under this house's own key"* — so a
house **billed to somebody else** has none, and the × drew its line from the group's bill and
then refused to remove it for want of a bill it never had. Seventeen numbers in the real book
are shared by two households, so this is not a rare shape. It resolves `billToPhone` first and
the house's own key second — the expression `billingGroupsByPayer` builds its map from.
- ⚠ **`allCustInvoiceFor` IS NOT WIDENED, DELIBERATELY.** The Edit Customer save needs exactly
  its narrow answer to find and zero a leftover invoice when somebody starts billing
  elsewhere, so widening it would fix the × and quietly break the save. Both halves are
  asserted, because the second is the one a tidy-up would lose.
- ⚠ **And a genuinely missing invoice names the tool that makes one** (Invoices → *Fix Missing
  Invoices*) rather than stopping at a fact the office can do nothing with. A refusal with no
  next step is what sends somebody looking for a bug that is not there.

⭐ **ANY FEE OR DISCOUNT CAN BE CROSSED OFF WITH AN ×** (added 2026-09-02, MON-53/54/55).
Addie: *"right now we don't have a way to waive a late invoice fee"*, and then *"to be
honest we should have an x next to all discounts and fees to get rid of those if
necessary."* Every line on either ledger — `changeFeeNotes` (fees) and `creditNotes`
(discounts) — is drawn with an × beside it, in **two** places: the Invoices panel, and
the Fees / Discounts boxes in **Edit Customer**. Pressing one saves straight away and is
written into that customer's history.
  - ⚠ **The carried debt was the one line with no ×, and since MON-67 it has one** — see
    *AND THE CARRIED DEBT HAS AN ✕ NOW TOO* above, which carries this bullet's reasoning
    forward rather than dropping it. It rides in the same fee ledger, and
    `arrearsOutstanding` is what holds an unpaid customer off the schedule, so removing it
    lifts the hold — that IS the "hang them anyway" button Addie was offered and turned
    down in MON-38, and what changed is that it can no longer happen silently. **Nothing
    on the discount side is protected**: a credit can only ever be money coming off.
  - ⚠ **This replaced a button that cleared the lot.** "Remove light-change fee(s)" wrote
    `changeFeeNotes: []`, and by then that array held manual fees and the carried debt as
    well — so a control labelled as removing a colour-change fee also wrote off a real
    debt and released the hold, silently, in one press.
  - ⚠ **A referral discount also clears the referral count, AND marks the entries behind
    it** (widened 2026-09-03). That credit is *derived*, so taking the line off without
    zeroing the count is an × that visibly works and is undone by the next save. Since the
    referral link shipped the count is derived from `referralCredits[]` rather than being
    the record itself, so zeroing the count alone was no longer enough either: the next
    referral through a link recomputed it from the entries and put the whole discount back.
    Each live entry is marked `waived` in the **same write** as the count — `waived` kept
    apart from `revoked`, because one means the office crossed it off and the other means
    the friend cancelled, and a season later that difference is what explains the bill.
    ⭐ **AND SINCE 2026-09-08 (REF-24) IT IS ONE LINE PER REFERRAL, NAMING THE FRIEND,
    WITH A × EACH.** Addie: *"in discount I cannot currently see who got what discount.
    That should show with an x at the right side."* The × was already there; **who** was
    missing — every referral collapsed into a single "Referral — 3 people" line, so the
    office could see $75 had come off and never which three friends earned it, and one ×
    took all three off at once. `referralCreditNotes` builds a `{amount, reason, kind,
    ref, date}` line per live entry, `ref` being the referred customer's id, and the ×
    marks **that entry alone** `waived`.
    ⚠ **The count is RECOMPUTED, never zeroed**, now that one × need not mean all of
    them — writing `referralCount: 0` would wipe the discount for referrals nobody
    crossed off.
    ⚠ **An old collapsed line still means all of them.** Every invoice raised before this
    holds one line with no `ref`; a × that matched nothing there would take the money off
    and leave the count standing to put it straight back on the next save.
    ⚠ **A typed count with no entries behind it is unchanged.** The People They Referred
    box writes a number nobody linked to a person, so anything it claims beyond the
    entries stays one collapsed line — which is also the whole of the Add Customer path,
    where no entry can exist yet.
  - ⭐ **WHICH SEASON THE $25 COMES OFF** (2026-09-08, REF-23). Addie: *"if someone shares
    there referal link but denied for this year than they will get discount for next year
    however if they approved for this year they will get discount for this year."*
    ⚠ **Without it the $25 was simply lost.** A customer who has said no or Back Next Year
    has no bill this season, so `applyReferralCreditLine` found no invoice and returned
    false — and REF-14 then stopped the entry counting in any LATER season, because it was
    stamped with the year it was earned. Somebody who brought us a customer while sitting
    out earned nothing at all, silently.
    ⚠ **`referralCreditSeason` asks `houseIsOnTheBill`, not `isOutForSeason`.** This is a
    question about a BILL — is there one this season for the discount to come off — and
    that rule already answers it and is swept against the server copy by money-parity.
    `isOutForSeason` would be wrong twice: it also returns true for `needsLightRecycle`, a
    warehouse state that says nothing about money, and once `SEASON_ELIGIBILITY` is live it
    returns true for everybody who has not replied, which would push almost every referral
    in the book to next season on the day the RSVP goes out. A house that was **hung** is
    billed (Q-013), so a flat "no" on a completed house still earns it this season.
    ⚠ **Held credits are shown, never put on the invoice.** `referralHeldCount` feeds the
    Refer a friend row in Edit Customer — "+1 held for next season" — because adding them
    to this season's credits would take money off a bill they are not for, and leaving them
    invisible makes a referral earned while sitting out look exactly like one that never
    counted.
    ⚠ **One case is deliberately open**: somebody who earns a credit while they are IN the
    season and answers no afterwards keeps a credit stamped for a season they are no longer
    billed for. `docs/open-questions.md` Q-029.
  - ⚠ **No late fee is charged today.** The rule is decided and unbuilt ($25 if they have
    paid something, $40 if they have not — PROC-32). The × is built against the ledger
    rather than against a named fee, so a late fee written later is waivable the day
    something writes one, with nothing here to change.

⭐ **A REFERRAL LINK, AND THE $25 THAT FOLLOWS IT** (added 2026-09-03, REF-01 to REF-06).
Addie: a member gets their own link, and when somebody joins through it $25 comes off the
member's bill — with nobody in the office typing anything.

- **Where the customer gets it.** A **Refer a Friend** tab in their own portal: the link, a
  **Share My Link** button, and how many people have joined through it. The address is
  `.../?ref=<referralToken>#/quote`.
  - ⛔ **TWO SESSIONS BUILT THIS BUTTON TWO DIFFERENT WAYS, AND ONE OF THEM IS NOT IN THE
    TREE** (reconciled 2026-09-07). Both answered the same complaint — the Refer a Friend
    button landing the CUSTOMER on the friend's quote form — and both worked. The one that
    ships is the **`/s/<token>` share page** below. The other pointed the button at
    **`/r/<token>?share=1`** and had the `/r/` reader branch on the flag. `/s/` shipped
    first, was merged, is deployed, and carries its own Netlify rewrite in `_redirects`
    plus `referralShareLinkFromToken` in admin.html and the server; adopting `?share=1`
    would have re-pointed all of that at a query flag.
    - ⚠ **The deciding argument is not which is nicer — it is that one is already live.**
      Half of each is the only genuinely bad outcome: a button pointing at a page that does
      not exist, which from the customer's side is indistinguishable from the referral
      scheme being broken.
    - ⚠ **The RULING behind both is unchanged** and is REF-12/REF-13: the button opens the
      customer's own share sheet, the bare link stays the friend's. Only the mechanism was
      contested, which is why this is written here and not in the questions map — that file
      is for decisions a person made, and this one was a merge call.
    - ⚠ **The dropped side's tests went with it.** A suite asserting `?share=1` against a
      tree that does not implement it fails for the right reason and would have been
      "fixed" by somebody re-adding the flag; its duplicate `page-share` markup went too,
      because two elements with one id is a page where the wrong one wins silently.
    - ⚠ **AND THE DROPPED HALF WAS STILL IN THE TREE UNTIL 2026-09-08.** The two sides
      never touched the same lines, so the merge kept BOTH — and the result was two
      `else if(hash === '/share')` branches in `index.html`'s router. The first always
      matched, it read `?t=` while the second's producer wrote `?token=`, and the second
      could never run: every surviving `?share=1` link landed on the share page with no
      token and drew *"that link is missing its code"*. A dead door that read as live in
      the source, and **nothing went red** — every share-page check drives `/s/`, which is
      the branch that won, so a duplicate branch is invisible to any test that only
      exercises the winner. The `?share=1` flag, the unreachable branch, its
      `share-minimal` CSS and a comment claiming the email buttons pointed at it are all
      gone; `/s/` is the one door. Suite 308 now counts the hashes the router tests and
      fails on a repeat, which is the general form of this.
      ⚠ **One thing went with it that was not a mistake**: their `share-minimal` styling
    gave the share page the whole screen, with the site header and footer hidden. That
    is a design change nobody asked for, so it was not smuggled in on a merge — the page
    looks exactly as it has since 2026-09-05. It is four CSS lines if it is ever wanted.
  - ⭐ **ONE TOKEN, TWO ADDRESSES, FOR TWO DIFFERENT PEOPLE** (2026-09-05, REF-13).
    `/r/<token>` is what the **friend** opens — it stores the token and goes to the free
    quote form, which is what credits the referral. `/s/<token>` is what the **customer**
    opens: their own share page, `#/share`, with the link and the share sheet on it.
    Dax tapped the Refer a Friend button in an RSVP and landed on the quote form, because
    that button carried `/r/`. It carries `/s/` now, in `referralShareLinkFromToken`
    (admin.html) and character-for-character the same in `runArrearsRsvpBatch`
    (functions/index.js). **`{{referral_link}}`, the bare token, still resolves to `/r/`**
    — that one is pasted into an email as text for the customer to forward, so it is the
    friend's address by design.
  - ⭐ **WHAT THE OFFER LOOKS LIKE IN THE EMAIL: THE LINK, IN A BOX, WITH THE SHARE
    SQUARE BESIDE IT** (2026-09-07, REF-19). Addie, sent the version built the day before
    and shown a picture of what she meant instead: *"Okay i was thinking it would look
    like the second picture"*. A bordered box holding `highlightingutah.com/r/<token>`
    where she can read it, and one small gold share square next to it. **No gold
    call-to-action button.** That finishes REF-17 rather than undoing it — Dax asked for
    *"a share icon right next to link"*, and while the link only ever rendered AS a button
    there was no link for the icon to sit beside.
    ⚠ **The words and the `href` in the box are both the FRIEND's `/r/` link** — that is
    the thing being copied out and forwarded, and what it says has to be where it goes or
    a long-press copies the wrong address. **The ICON carries `/s/`**, the customer's own
    share page, so the tap Dax complained about still lands on the share sheet.
    ⚠ **This is the one place an earlier answer was reversed rather than refined.** Dax,
    2026-09-05: *"that button that says share my link should be the same button we send in
    their email"* — the words **Share My Link — $25 Off** were to match the share page's
    own button, and they said "$25 Off" here and "$25 off your bill" there until that was
    fixed. **The page still says them; the email now shows the address instead**, on her
    newer answer. The paragraph above the box still says $25.
    ⚠ **One builder per file, not four inline copies.** `referralShareBoxHtml` in
    admin.html (used by `referralEmailBlock` and `resolveLinkTokens`) and
    `referralShareBoxHtmlServer` in functions/index.js (used at both spots in
    `runArrearsRsvpBatch`). Suite 308 RUNS both on one pair of addresses and compares the
    bytes, rather than policing four regions and counting icons against buttons — which is
    what it did before, and a red-check had already shown two of the four could be dropped
    and sail through.
    ⚠ **A table, not a flex row**, and inline styles only: Outlook has neither flexbox nor
    `border-radius`, so it degrades to a square box with the link and the icon still side
    by side, which is the whole of the design.
    ⚠ **AND IT IS THINNER SINCE 2026-09-08** (REF-20). Addie: *"can we make this box a
    little thinner just is thick."* Padding only — the shape is unchanged, so REF-19 is
    refined rather than superseded: the icon lost its 6px top-and-bottom margin and went
    from 11px to 9px of vertical padding at 15px rather than 16px, and the two cells went
    from 10px/6px to 8px/4px. About 62px tall to about 41px. It did not go thinner still
    because the icon is a **tap target on a phone** — it is what reaches the share sheet,
    and a 20px gold square in an email is a miss as often as a hit. Both renderers moved
    in the same push, which suite 308's byte-for-byte comparison enforces.
    ⚠ **AND THE SQUARE HOLDS AN ARROW, NOT A TRAY** (2026-09-08, REF-22). Addie sent a
    picture of the macOS share button: *"can we cahnge the share button to this instead."*
    The exact glyph is an Apple **private-use** SF Symbol — it renders on Apple devices
    and as an empty box everywhere else — and REF-17's no-`<svg>`-no-`<img>` rule stands
    (a hosted PNG is worse: most clients block remote images, so the icon would simply be
    absent, which is the REF-21 complaint all over again). So **the gold rounded square is
    the box**, and a plain `\u2191` (U+2191) on it is the arrow coming out of the top.
    `\u2191` is a text arrow, not an emoji: monochrome everywhere, inheriting the button's
    own dark green. `\u2b06` was rejected for the opposite reason — many clients draw it as
    a blue emoji arrow, which fights the gold. 17px bold so it reads as the thick arrow in
    her picture rather than a stray character.
  - ⭐ **AND THE OFFICE CAN OPEN THAT PAGE** (2026-09-07, REF-18). Addie, after the share
    icon shipped: *"where do I find the page that comes up after pushing the share link
    icon cause I thought it would just go to there member portal refer a friend section."*
    It is not the portal's Refer a Friend tab and deliberately never was — that tab needs
    a sign-in, and an email button that signs somebody in hands the account to whoever the
    email was forwarded to (the rule above). But **both** surfaces that showed a referral
    link showed `/r/`, the friend's address, so the customer's own `/s/` page was reachable
    only from an email and looking at it meant copying a link and editing the URL by hand.
    A **See their share page** anchor now sits beside **Copy link** on the Refer a friend
    row in Edit Customer, built from the same `d.referralToken` as the box next to it.
    ⚠ **The box still holds `/r/`** and that is the half that costs money: `/s/` handed to
    a friend is a page about sharing that credits nobody, so the $25 is never earned and
    the only symptom is a referral that quietly did not count. Suite 308 asserts both
    directions, and that the two addresses come from the one token on the record.
    ⚠ **An anchor, not a button** — it navigates rather than doing anything, so there is
    no handler to wire, and a control whose listener silently did not apply is a failure
    this repo has already shipped once.
    ⚠ **Suite 276 RUNS `editCustRenderReferLine`**, so `referralShareLinkFromToken` had to
    join its lift list in the same change. The new call sits inside `if(url)`, so a
    tokenless fixture hides the gap and the suite stays green while one fixture away from
    a bare ReferenceError that takes the whole run down. A red-check is what found it.
  - ⭐ **AND THE SEND SAYS WHEN SOMEBODY GOT NO LINK** (2026-09-08, REF-21). Addie:
    *"why is the referal share button/link not working anymore… its not even showing up
    anymore."* The rendering was right; **the silence was the bug.** Every path here emits
    an empty string rather than a dead link — correct for the customer, invisible to the
    office — so a whole-book RSVP carrying no offer at all produced the same green
    *"Done — sent 312"* as one where everybody got theirs.
    ⚠ **`referralOfferFor` is now the one resolver**, and it returns the REASON beside the
    html. `referralEmailBlock` and the send both read it, so the email and the report on it
    cannot disagree about whether a customer has a link. `referralOfferProse` holds the $25
    sentence once, for the same reason.
    ⚠ **The send counts and names.** `etSendTemplateRun` returns `noReferral` and up to
    five names with reasons; `referralMissingNote` writes the one sentence both senders
    print. Empty when nobody was missed — a warning on every ordinary send is one the
    office learns to scroll past.
    ⚠ **AND `Check first` SAYS WHERE THE OFFER WILL APPEAR, BEFORE ANYTHING GOES.**
    `referralOfferPlacement` answers `code` (her template places `{{referral_button}}`, so
    the box lands where she put it), `appended` (it does not, so REF-15 puts the offer on
    the END) or `none`. **This is the line that answers her question without sending
    anything**: her own RSVP body carries no code, so the offer was going to the bottom
    rather than beside the sentence she had written about it, and nothing anywhere said so.
    ⚠ **The customer's email is unchanged** — `html` is '' in exactly the same cases as
    before — and the offer is counted whether the template places the code or not, because
    the token behind both paths is the same one.
    ⚠ **And the rendering is RUN now, not read** (suite 311). It never had been: suite 305
    matched a regex over a slice of the file and suite 308 ran the box builder on addresses
    it supplied itself, so nothing had ever asked *given a real customer record, does a
    link come out*. ⚠ `resolveLinkTokens` **cannot be lifted by `extractFn` at all** — it
    contains the string `'{{custom_'`, two opening braces with no closers, which runs the
    brace counter off the end of the file and makes the function read as MISSING — so a
    suite written the ordinary way would have skipped, silently, for ever. It is sliced
    between its own signature and the next declaration, and the slice is asserted whole
    before anything runs on it.
  - ⚠ **The share page stores NOTHING as a referral.** The `/r/` reader writes the token
    into `sessionStorage` so the quote that follows is credited; doing the same on `/s/`
    would mark the customer as referred by themselves and their next quote would be
    refused as a self-referral — over a link we sent them. It is public, signs nobody in
    and shows nothing but the link: an email button that signed somebody in would hand
    the account to whoever the email was forwarded to. A forwarded email still works —
    the page carries a quiet "Somebody send you this? Get a free quote" whose href **is**
    the `/r/` link being shared.
  - ⭐ **The button opens the phone's own share sheet** (2026-09-05). Dax: *"we would
    rather have it as a share link so it opens share options where they can copy it or
    send it to contact"*. `navigator.share`, so the customer picks a contact, Messages,
    Mail — or Copy — from the list their phone already gives them, instead of landing
    the link on a clipboard and having to go and find somebody to paste it to. Nothing
    is sent by us and this page never learns who they sent it to, so it is still not
    the "enter your friend's email" feature and carries none of its problems.
  - ⚠ **Copying is the fallback, and the label says which one you are getting.**
    `navigator.share` is absent in desktop Firefox, on a plain http origin and in
    several in-app browsers, so where it is missing the button reads **Copy My Link**
    and copies exactly as it did before. A button reading Share that silently copies
    leaves a customer waiting for a sheet that is never coming. Backing out of the
    sheet (`AbortError`) says nothing at all — changing your mind is not a failure —
    while any other rejection falls through to the copy rather than dead-ending.
  - ⚠ **The link carries a referral token, never the portal login token.** A portal token
    signs somebody in; this one is pasted into a group chat. The customer number is not used
    either — it is printed on invoices and bins, so it is guessable.
  - ⭐ **Every customer has one, without anybody pressing anything** (REF-10). All four
    places a customer record is created mint a `referralToken` in the same write as the
    portal token; opening a customer in Edit Customer makes one if they have none (once
    per customer, ever — `referralTokenFor` returns early when one exists); and
    **Bulk Updates → Make referral links for everyone** covers the book as it stood. That
    backfill only ever ADDS, so it is safe to press twice and needs no typed confirmation.
  - ⭐ **The address is `/r/<token>`, 39 characters** (REF-11) — a Netlify 200-rewrite,
    exactly like the `/q/` quote link and for the same reason: a text is billed in
    160-character segments. The token is **8 characters from its own generator**;
    `generatePortalToken` stays 20 because it signs somebody into their account. The old
    `?ref=…#/quote` spelling still works for ever, so links already shared keep counting.
  - ⭐ **The tab is OPEN to somebody who owes for last season** (reversed 2026-09-04,
    REF-07). It was locked for one day and Addie reported the result — *"its not showing
    up anywhere"* — because most of the book carries an unpaid 2025 balance, so the tab
    she had just asked for was greyed out on nearly every record she opened. The held
    tabs are the ones that make work for us; referring a friend puts **nothing** into the
    system and can only take $25 **off** this customer's bill.
- **What the visitor's quote carries.** The public page reads `?ref=` and stores
  `referredByToken` on the new quote. It is remembered for the SESSION, not read at submit
  time: somebody who lands on the home page and reaches the quote form ten minutes later
  still counts. Nothing is validated in the browser — a public page must not be able to look
  up customers, so an unknown token is refused later, and silently, because a link can
  outlive the customer who made it.
- **When the $25 lands.** `creditReferralIfAny` is called at BOTH doors into a customer —
  the Add Customer conversion and an applied re-quote — and written once rather than inlined
  twice.
  - ⚠ **It writes the credit line itself and does not wait for a Save.** The existing
    People They Referred box rebuilds that line only when somebody opens the record and
    presses Save, so bumping a count from a background write changes the record and nothing
    on the bill. `applyReferralCreditLine` owns the `referral` kind and keeps every other —
    the same discipline that stops `carried` and `manual` colliding.
  - ⚠ **The total is rebuilt from the lines, never incremented.**
  - ⭐ **ONE LINE PER FRIEND, NAMED, EACH WITH ITS OWN ×** (REF-24, 2026-09-08). ⚠ This
    entry read *"two referrals are ONE $50 line rather than two saying Referral"* until
    2026-09-08, which was true when it was written and had stopped being true the same
    day. Two referrals now draw **two** lines — *Referral — Kyle New −$25* and
    *Referral — Maria Lopez −$25* — and crossing one off leaves the other standing.
    Each carries `ref`, the referred customer's id, which is what lets one × mark that
    one entry `waived` rather than all of them. A count TYPED into the People They
    Referred box beyond the linked entries still adds one collapsed *"Referral — N
    people"* line, because nobody linked those to a person.
  - ⭐ **AND THE INBOX NOTE ONLY CLAIMS A BILL WHEN THERE IS ONE** (REF-30, 2026-09-08).
    `applyReferralCreditLine` gives up when the referrer has no invoice document — a real
    state, which is why *Invoices → Fix Missing Invoices* exists — and its answer used to
    be thrown away, so the note said the $25 *"has been taken off their bill"* when nothing
    had been. The referral is still counted either way; what changed is that the note now
    says it is **not on a bill yet** and names the tool that makes one. The clawback note
    had the identical hole and moved in the same push.
  - ⚠ **The credit goes to the referrer's OWN invoice key**, not to the bill they are on
    when they bill elsewhere — so a tenant's $25 can land on a leftover invoice nobody
    reads. Both writers agree on that today, so it is a settled shape rather than drift,
    but where it SHOULD land is undecided: `docs/open-questions.md` Q-030.
- ⭐ **THE LINK IS NOT SINGLE-USE, BUT ONE FRIEND EARNS IT ONCE** (REF-31, 2026-09-08).
  Addie: *"If the link is used twice for two separate people and addresses then we can
  give the costumer to referral discounts but discount only takes affect after they are
  converted to costumer."* Two friends through one link is two $25 discounts on two named
  lines — that already worked, because the idempotency guard is `referralCredited` on the
  QUOTE. What did not work is the other half of her sentence: one friend who submits the
  public form twice is two quotes, so the referrer was paid **$50 for one house**, and
  nothing said so. `referralAlreadyCreditedFor` refuses the second, matching on phone or
  email — never the address, and never the name.
  - ⚠ **The refusal goes through `referralBlocked` like the other two**, so it is stamped
    on the quote, recorded on the referrer's own record and named in the Inbox. The office
    can still put it right by typing the count up.
  - ⚠ **Revoked does not block; waived does.** Revoked means that friend cancelled, so a
    genuine re-join earns it properly. Waived means the office crossed the $25 off on
    purpose, and re-crediting it would undo that decision silently.
  - ⚠ **Two different people at ONE address currently earn two discounts** (they differ by
    phone and email). That reads right — two customers, two bills — but her wording could
    be read the other way, so it is asked rather than assumed: `docs/open-questions.md`
    Q-031.
- ⭐ **THE TOKEN HAS TO SURVIVE THE TRIP FROM THE LINK TO THE FORM** (REF-33,
  2026-09-08). Addie shared her link with two people through the phone share sheet; both
  filled the form in, neither counted, and the one she converted was still charged the
  $30. One fact behind both: `referredByToken` never reached the quote — the fee waiver
  and the $25 both hang off that single field.
  - ⚠ **It rode in `sessionStorage`, which is per TAB.** A link tapped in Messages opens
    in that app's in-app browser; closing it and coming back through the front door, or
    tapping "Open in Safari", loses it. On a phone that is the ordinary path, not an edge
    case. It is now in `localStorage` too, and **the token stays in the address bar** as
    `?ref=` — the `/r/` reader used to strip it, and the URL is the only thing that
    survives a change of browser.
  - ⚠ **It expires after `REFERRAL_REMEMBER_DAYS` (90)**, and an undated stored token is
    treated as too old rather than kept for ever. A newer link always beats a remembered
    one.
  - ⚠ **`test/referral-token.spec.js` reproduces her flow** and reads the real quote
    write, because everything here is about what a browser still has after a navigation.
- ⭐ **AND THE ROW COUNTS THE FRIENDS STILL WAITING ON THE OFFICE** (REF-32). The $25
  lands on conversion, so a friend who has only submitted a quote has earned nothing yet
  — and this row used to call that "nobody has joined through it yet", the same sentence
  it gives a link nobody has ever opened. Those two need opposite actions.
  `referralPendingQuotes` counts quotes carrying the customer's token (current or past)
  that are not yet credited, refused, archived or converted, and the row names the next
  step. ⚠ It counts QUOTES, not people — deduping here would be a second copy of the
  REF-31 rule that decides who gets paid.
- **Nothing is credited until they are a customer.** `creditReferralIfAny` is called only
  at the two conversion doors, so a quote that merely carries the token has moved no
  money — her *"only takes affect after they are converted"*, now asserted rather than
  left as a property nobody checked.
- ⭐ **THE ROW HOLDS THE LINK; THE DISCOUNTS BOX HOLDS THE MONEY** (REF-34, 2026-09-09).
  Addie: *"It looks like you put it here. It should be under here."* The joined, waiting,
  refused and held counts render in `editCustReferStatusLine` inside the Discounts box,
  beside the discount they explain. One function still writes both halves, so the two
  panels cannot disagree about the count; the Copy feedback stays with its button.
- ⭐ **AND THE FRIEND'S MESSAGE PROMISES THE $30 WAIVER** (REF-35, 2026-09-09). It did
  not until now: `referralShareLine` holds that promise and **nothing called it** —
  `navigator.share` was handed a hardcoded sentence about a free quote, while the comment
  above the function claimed otherwise. The fee is read from `NEW_MEMBER_FEE`, never
  typed. ⚠ The Copy fallback still copies the link alone, deliberately — the button says
  *Copy My Link* and it is the desktop path where the customer writes their own message.
- **Who is refused.** Either the phone or the email matching the referrer's is a hard
  refusal, and their own record is refused first by document id. **Nothing verifies either
  field** — no OTP exists here and building one was turned down — so a determined person can
  still use a real friend's details. That is an accepted, documented gap; this rule and the
  Inbox note are the only defences. A refusal is marked on the quote so it is not retried
  for ever, and it raises its own note, because a refusal nobody can see is indistinguishable
  from the link not working.
  - ⭐ **AND THE REFUSAL IS ON THE REFERRER'S OWN RECORD** (2026-09-08). Dax: *"someone
    joined and accepted a quote under this referral link but you cant see him get the
    discount here."* Nothing was wrong — the referral was refused, correctly, because the
    friend's quote carried the **same phone number** as the link's owner. But the refusal
    was written to the QUOTE and to the Inbox and never to the customer, so **Refer a
    friend**, the one row on their own screen about their own link, still read *“nobody has
    joined through it yet”* after somebody had joined through it. That row now says how
    many uses earned nothing **and why**, and reads *“nobody has joined through it and been
    credited”* rather than claiming nobody came.
  - ⚠ **It is its own field, `referralBlocks`, never `referralCredits`.** Every count,
    every line on a bill and the clawback read the credit array; a $0 refusal parked in it
    would have to be excluded by each of them separately.
  - ⚠ **Best effort, and it cannot cost the two traces that already worked.** The write
    has its own catch, so a failure still leaves the quote stamped and the Inbox note
    raised. It is keyed on the quote id, so a re-run refusal is still one refusal.
- ⭐ **HOW LONG A REFERRAL IS WORTH $25** (2026-09-07, REF-14). Dax: *"a referral is $25
  off for the current season per refferral."* It comes off **the season it was earned in**
  and no season after it. ⚠ **Before this it was a discount for life, and nobody had
  decided that**: entries are deliberately never deleted (they are the audit trail), and
  `referralLiveCount` counted every one of them for ever — so a friend referred in 2026
  took $25 off the 2027 bill, the 2028 bill and every bill after. Three referrals in one
  good season quietly became a standing $75 discount off a list nobody re-reads.
  - ⚠ **Per referral, not per friend per season.** The friend coming back next year is not
    a second referral and earns nothing; a NEW person referred next year does.
  - ⚠ **The season is `new Date().getFullYear()`** — the definition this app already uses
    (`audienceNeverAsked` compares the quote-join year against it; Start New Season files
    its snapshot under it). A second idea of when a season starts is the shape this repo
    keeps finding in its own history.
  - ⚠ **Old entries are read, not migrated.** Anything written before this has no `season`,
    so the year of `creditedAt` stands in for one — a pure read-side rule, no pass over the
    book, nothing rewritten. An **undateable entry still counts**: wrongly dropping $25
    somebody earned is the expensive mistake, wrongly keeping one costs $25.
  - ⚠ **`revoked` and `waived` are unchanged** and still beat the season test.
  - ⚠ **The server copy moved in the same push.** `clawBackReferralServer` recomputes the
    live count, so without the same filter one customer declining in their own portal puts
    every expired credit back on the referrer's bill — the `waived` failure, one rule on.
- **When it is taken back.** The referred customer cancelling BEFORE their install revokes
  the entry and takes the $25 off. After the install it stands — the referral did its job.
  And never off a bill already Paid in Full: that turns credit into money owed, which is a
  bill arriving after somebody has paid.
  - ⚠ **Both doors out of the season do it**: the office dropdown (`clawBackReferralIfAny`)
    and the customer's own portal (`clawBackReferralServer` in `portalRsvp`). A decline
    through the RSVP link never reaches the office screen, so one alone leaves the credit
    sitting there.
  - ⚠ **The entry is kept, marked revoked, never deleted.** A list that quietly shortens is
    one nobody can audit.
- **What it writes.** On the referrer: `referralToken`, `referralCredits[]` (the source of
  truth) and `referralCount` (derived from it, and what the existing box shows). On the
  referred customer: `referredByCustomerId`, set once — it is what the clawback finds its
  way back by. On the quote: `referredByToken` and `referralCredited`.
- **And it goes in the RSVP email** (REF-08, REF-09). `{{referral_link}}` and
  `{{referral_button}}` are ordinary email tokens, offered in the token picker, and both
  BUILT-IN RSVP bodies carry the offer under the three answer buttons.
  - ⚠ **A template she has already written is never rewritten** (MON-24): the built-in
    bodies only fill a blank one.
  - ⭐ **AND THAT NO LONGER MEANS A HAND EDIT** (2026-09-07, REF-15). This used to say an
    RSVP template already saved in Firestore needed `{{referral_button}}` adding by hand,
    once. It does not: the send **appends the offer** when the body places neither token,
    and skips it when the body places one, so the offer cannot appear twice and her saved
    words are untouched on disk. MON-24 is intact — nothing is rewritten; the block is
    added at render time. Same shape as `addOnEmailBlock`, deliberately, because a second
    mechanism for "the saved template is missing a thing" would drift from the first.
    ⚠ **Both renderers, one push** — `referralEmailBlock` (admin.html, all three RSVP
    render sites: preview, send and test) and the `hadReferralToken` append in
    `runArrearsRsvpBatch` (functions/index.js). ⚠ And it emits **nothing** when the
    customer cannot be resolved, never a dead link.
  - ⚠ **Two renderers, one template — the `{{photo}}` shape again.** `resolveLinkTokens`
    in admin.html renders a hand-send; `runArrearsRsvpBatch` in functions/index.js
    renders the automatic Not Paid RSVP chase with no browser involved. A token resolved
    in only one of them puts a literal `{{referral_button}}` in a real customer's inbox.
    Change one, change the other, in the same push.
  - ⚠ **Resolved by document id, never by a guessed phone.** `hlxEmailCustomerItem` takes
    `opts.customerId` when the send has one and, falling back to a phone, returns nobody
    unless exactly one customer holds that number. Seventeen numbers in the real book are
    shared by two households, so picking the first hit mails one household the other's
    link — and every friend they then send it to credits the wrong customer.
  - ⚠ **No link means no button**, never a button pointing nowhere: a customer tapping
    something we sent them and landing nowhere cannot tell that from the scheme being
    broken.
  - ⭐ **A SHARE ICON, RIGHT NEXT TO THE BUTTON** (2026-09-07, REF-17). Addie: *"a share
    icon right next to link on automation email."* A second, small anchor sits beside
    the existing **Share My Link — $25 Off** button — same `refShareUrl`/`referShareUrl`
    as the button next to it, never an independently-built address that could drift from
    it — showing a plain 📤 emoji, never `<svg>` or `<img>`: inline SVG renders
    inconsistently across email clients (Outlook especially), and this repo has no
    hosted icon image for an email to reference, so the emoji is the same trick the RSVP
    body already uses for 🎄. It is a decoration on the existing button, not a second
    button — clicking either lands on the same share page.
    ⚠ **All four spots that build this HTML got it**: `referralEmailBlock` and
    `resolveLinkTokens` in admin.html (mirroring `QUOTE_LINK_BUTTON_STYLE` with a new
    `SHARE_ICON_BUTTON_STYLE`), and both copies inside `runArrearsRsvpBatch` in
    functions/index.js (a matching `shareIconBtn` style). The **$25 Off** button text
    itself was not touched anywhere, so every existing test pinned to it — including the
    cross-file "both renderers send it character for character" check — still passes
    unmodified.
    ⚠ **The icon is checked the same way the button is**: Suite 308 confirms the icon
    exists, that admin.html's and the server's copies read identically once the
    `resolveLinkTokens` copy's `📤` source escape is unwound the same way
    `emailLabel` already unwinds `—`, that the icon's href is built from the same
    URL variable as the button beside it rather than a second copy, and that the style
    is defined once in admin.html rather than once per call site.
- **Where to look when it is wrong.** The Inbox, System folder, money section: **Referral
  Credit Given**, **Referral Taken Back**, **Referral Blocked**. Proved by run-all.js suite
  299, which runs the rules against a fake Firestore; 19 sabotages red-checked.

⭐ **AND THE OFFICE CAN SEE IT AND SEND IT** (added 2026-09-04, REF-07/REF-08). Addie:
put the link at the top of Edit Customer, in Customers, and let it go out through the
RSVP. Both were impossible for the same reason: `ensureReferralToken` lives inside
`portalLookup`, so a customer got a token on their **first portal sign-in** and never
before it — and most of the book has never signed in.

- **In Customers.** A **Refer a friend** row at the top of Edit Customer, beside the bill
  line: the link, a Copy button, and how many people have joined. It shows
  `referralLiveCount`, not `referralCount` and not the raw array — a referral the friend
  cancelled is revoked and one the office crossed off with the × is waived, and neither is
  money off anybody's bill.
  - ⚠ **Opening the form mints nothing.** The button mints it, once, when somebody
    actually asks for the link. Minting on render would write to Firestore every time
    anybody opened the most-opened form in the app, for a link most of those opens will
    never use. When there is no link yet the row says so and offers **Make their link** —
    an empty field beside a Copy button reads as the feature being broken.
- **In an email.** `{{referral_link}}` and `{{referral_button}}`, in the token picker
  beside the portal and Venmo ones. ⚠ **Her own RSVP template is not rewritten** — the
  top-up only ever fills a blank body, never replaces words somebody has written — so the
  tokens exist and putting one in the email is her edit to make.
- ⚠ **The customer is resolved by `hlxEmailCustomerItem`**, which refuses a phone matching
  two customers rather than picking the first. Seventeen numbers in the real book are
  shared and fourteen are two households, so through a `.find()` a parent is emailed the
  **child's** link and every $25 that friend earns lands on the child's bill for the whole
  season. That resolver is now two functions on one rule — the item form is the rule,
  `hlxEmailCustomer` is one line on top of it — because a caller that WRITES to the
  customer needs the id, and a second resolver written beside it is how one of them
  quietly stops refusing a shared phone.
- ⚠ **An unresolved customer emits nothing at all**, not an empty `<a href="">`. A dead
  button in a bulk send is a customer tapping something we sent them and landing nowhere,
  which they cannot tell from the scheme being broken.
- ⚠ **One place builds the address**, and it must stay byte-identical to
  `portalReferralLink` in `index.html` — the customer copies one out of their portal and
  the office sends the other, and two links differing by a slash are one referral that
  credits nobody. Suite 305 runs both and requires the same string out.

⭐ **THE RSVP BUTTON SHARES, IT DOES NOT JUST LINK** (added 2026-09-06, REF-12). Addie: the
`{{referral_button}}` in the RSVP email used to point straight at the customer's own
`/r/<token>` — which is the **friend's** quote form, so a customer who tapped their own
"Refer a Friend" button landed on a page with nothing for them to do. She asked for one
button that brings up the phone's real share menu — contacts and every app — rather than
a link, and rather than two separate hardcoded Text/Email buttons (which is what this
briefly became first).

- **Email cannot pop a share sheet itself.** The button now points at
  `/r/<token>?share=1` — the same token, a second door. The `/r/` reader in `index.html`
  (right where it stores the token for the quote form) checks for `?share=1` first: if
  present, it routes to the new `#/share?token=<token>` page instead and returns before
  touching `REFERRAL_LINK_KEY` at all. **Every `/r/<token>` link already out in the
  wild, without the flag, still lands on the quote form exactly as before** — same
  discipline as the old `?ref=` spelling still working forever.
- **The share page (`#page-share`) has one job.** One `navigator.share()` button, prefilled
  with the customer's own link and a company-voice line — *"You've been recommended for
  Christmas lights. Light your house with Highlighting Utah!"* — deliberately not
  mentioning the $25, which stays in the RSVP copy that explains the program to the
  referrer, not in the message that goes out to a friend. Choosing Messages sends it as a
  text, choosing Mail sends it as an email — the OS decides, not this code.
- ⚠ **Two taps from the email, not one, and that is a platform limit, not a choice.**
  `navigator.share()` requires an actual user gesture; a page cannot pop it on load. Tap
  the email button to open the page, tap Share on the page for the real picker.
- **No share sheet, no dead end.** A browser without `navigator.share` (most desktop) gets
  Copy Link plus the same Text-a-Friend / Email-a-Friend links as a fallback, built from
  `referralSmsHref` / `referralMailtoHref` — the sms: link doubles the body under both
  `?body=` and `&body=` since Android and iOS read different separators and no
  user-agent sniff is worth betting a referral on.
- **The Member Portal got the same Share button**, right in the Refer a Friend tab beside
  the existing Copy My Link, feature-detected the same way — never removed, never hidden
  behind it.
- ⭐ **AND THE TEXT/EMAIL PAIR IS GONE, NOT HIDDEN** (2026-09-07, REF-12). Addie: *"I
  don't want a text and email button I want to do a share link kind of thing than
  depending on if they choose to send it through email or text or whatsapp it will
  change how its sent. Whatsapp and text should be the same."* `navigator.share` is
  handed ONE line and ONE link, and whichever app is picked does its own formatting —
  which is what makes Messages and WhatsApp identical **by construction**, rather than
  by two builders in this file happening to agree. `referralSmsHref` and
  `referralMailtoHref` (the hand-rolled `sms:` / `mailto:` bodies, and the only place
  those two could ever have diverged) are deleted; a browser with no share sheet gets
  **Copy My Link** and a line saying to paste it wherever they like.
- Proved by Suite 308: the share flag is read and never leaks into the friend-facing
  session store, the router knows the route, `referralShareLine` is *run*, not regexed,
  both share buttons hand over the same line and link separately, no hand-rolled sms:
  or mailto: builder is left in the page, and both email renderers carry `?share=1` on
  the button while `{{referral_link}}` stays the untouched plain URL.

⭐ **A FRIEND WHO COMES IN THROUGH A REFERRAL LINK PAYS NO SETUP FEE** (added
2026-09-07, REF-29). Addie: *"Anyone that is enrolled by refer a friend will NOT be
getting charged for the 30 dollar installation fee. Can we also add that in the
text/email."*

- **The money.** `quoteChargesSetupFee` in admin.html — already the single shared
  function behind the quote-card checkbox, Add Customer from Quote, and the automatic
  conversion path (see "THIS WAS FOUR COPIES OF ONE MONEY RULE" a few sections up) —
  gained one more default: a quote carrying `referredByToken` is not charged the
  $30 setup fee, right beside the existing "a re-quote is never a join" rule and
  checked the same way. `referredByToken` is written on the quote itself the moment
  a friend submits the public form through a `/r/<token>` link (index.html), which
  is well before a referral is "earned" at install — this waiver does not wait on
  that.
- ⚠ **The office's own explicit answer still wins, in both directions**, exactly
  like the re-quote rule beside it: `chargeSetupFee !== undefined` is checked
  first and returns before the referral default ever runs. This is a default for
  when nobody has answered, not a hard block — if the office deliberately ticks the
  fee on for a specific referred quote, that tick wins. (Addie confirmed this is
  the behaviour she wants, rather than a rule with no override.)
- **The copy.** The friend-facing share message (`referralShareLine`, index.html)
  now says so directly — *"You've been recommended for Christmas lights. Light your
  house with Highlighting Utah! Sign up through this link and your $30 installation
  fee will be waived."* This is new: the message was deliberately built with no
  dollar amounts (see REF-12 above), on the reasoning that naming the referrer's own
  $25 credit there would read as self-serving. The $30 waiver is different — it
  benefits the FRIEND, not the referrer — so it stays out of self-serving territory
  and Addie asked for it by name. The RSVP email's own explainer to the referrer
  (the "$25 off your bill" line, and the share page's matching note) is unchanged.
  - ⚠ **The wording was NEGATIVE until 2026-09-09 and is now positive** (REF-36).
    It read *"you will not have to pay the $30 installation fee"*; Addie: *"lets
    reword the you will not have to pay 30 dollars installation fee cause not can
    be overlooked"*. Nothing about the waiver changed. The figure is still read
    from `NEW_MEMBER_FEE`, never typed, because it moved $30 → $25 → $30 in four
    days (MON-63/MON-64).
  - ⛔ **It was not being sent at all until 2026-09-09** — `portalShareLink` handed
    `navigator.share` a hardcoded sentence and `referralShareLine` was called by
    nothing. The account of that is the REF-35 bullet a few sections up; it is not
    repeated here. What this section adds is the check that now answers *"is the
    referral message actually going out"*: suite 308 RUNS `portalShareLink` with a
    fake share sheet and reads the `text` it was handed. Reading `referralShareLine`
    alone proves the sentence and nothing about who sends it, which is why two green
    suites missed it.
  - **The quote page the link lands on says nothing yet.** Addie asked for one line
    there too — *"Your $30 installation fee is waived"*, nothing under it — and it
    is **decided and not built** (REF-37): the public page cannot tell a real token
    from an invented one, and a link from a rotated season is deliberately still
    charged (REF-25), so the banner would promise a waiver the office then refuses.
    `docs/open-questions.md` **Q-032** carries the three ways out.
⭐ **AND THE LINK EXPIRES AT THE END OF THE SEASON** (added 2026-09-07, REF-25). Addie:
*"If referal link is from last year and they are using it than it should still charge 30
dollar fee. They should use there new referal link every year which should give new
referal links every year."* This narrows the rule directly above it.

- ⭐ **Start New Season is what hands out the new links** (REF-28). Addie: *"Can we just
  have a button we can push that says start new season and it will update everything?"*
  One press rotates every customer's referral link, stamps it with the season, and keeps
  the retired token so the $25 credit can still resolve it. **The season is the button,
  not the calendar** — the lazy year-turnover rotation this shipped with is REMOVED, not
  kept alongside: it fired on 1 January, weeks after somebody might have shared a link in
  December while that friend was still deciding, and it meant the button would rarely be
  the thing that actually rotated anything. Two triggers for one rule also let the browser
  and server copies take turns replacing each other's token, so a customer's link would
  change every time anybody looked at it.
- ⚠ **Every customer, not the ones in scope.** The rest of that handler is scoped to
  everyone-except-No because it resets SEASON state. A referral link belongs to the
  person, not to their answer — leaving the out-of-scope ones alone would let somebody
  who said No keep a link that waives the set-up fee for ever.
- ⚠ **It runs last, after the money, and a failure is reported rather than swallowed.**
  If the links fail the season is already correctly reset and pressing again finishes
  them; the other order risks the reverse. The count is named in the finish line so nought
  links is visible.
- ⚠ **And the confirmation says so.** That is the last screen before an irreversible
  write, and every customer's link being replaced is not something to find out afterwards.
- ⚠ **The cost, accepted knowingly: nothing rotates if the button is never pressed.** That
  same button resets every invoice, so a season nobody starts is broken long before a
  stale referral link matters.
- ⚠ **`referralTokenFor` and `ensureReferralToken` only ever MINT.** A record with no
  token gets one; a record with one keeps it, whatever year it is. `referralRotationUpdates`
  is the only thing that replaces a live token and Start New Season is its only caller.
- ⚠ **The season stamp is descriptive, not decisive.** Nothing about money reads it — the
  waiver asks whether a token is the one on the record right now (`holder.current`), which
  is a fact rather than a date comparison, and does not go wrong on the links minted before
  stamping existed which carry no stamp at all. The stamp is there so the office can be
  told WHICH season a retired link came from, and "an earlier season" is what it says when
  it does not know.
- ⚠ **Old tokens are kept, not discarded** (`referralTokensPast`, last five). The $25
  credit resolves a link back to whoever made it; throwing the retired token away would
  have quietly ended that credit for every link already out in the world. Addie ruled on
  the **fee**, not the credit, so a retired link still earns the $25. **That half is not a
  live question yet** (REF-27): no such link exists, so there is nothing to decide until
  next season.
- ⭐ **AND IT CLOSED A HOLE NOBODY HAD ASKED ABOUT.** The first version waived the fee for
  any non-empty token, so `/r/anything` typed into the address bar bought $30 off — the
  browser cannot tell a real token from an invented one by looking at it. The waiver now
  asks whether this is the link that customer holds right now, so an invented token and a
  retired one are both charged.

⭐ **AND THE CARD SAYS WHY THE BOX IS UNTICKED** (added 2026-09-07, REF-26). Addie: *"For
referals for not tickig the box the reason is refferal."* `quoteChargesSetupFee` answers
false for three quite different reasons — a re-quote, a referral, or the office having
unticked it themselves — and only the first had ever said so on the card.
`quoteSetupFeeReason` names the referrer where we know them, says *last season's referral
link — fee still applies* for a stale one, and *not recognised* for a token that matches
nobody rather than calling it a referral. It **describes, it never decides**: every branch
reads what `quoteChargesSetupFee` already worked out.

- Proved by Suite 310: `quoteChargesSetupFee` is *run*, not regexed, against a fixture
  book holding a live link, a stale one and an undated one — the office's-answer-wins
  ordering, the referred-quote default, the stale and unknown tokens both being charged,
  both override directions, and the re-quote rule's independence from the referral one
  all checked as separate cases; `quoteSetupFeeReason` is run for each of those; and the
  friend-facing message is built with the real `NEW_MEMBER_FEE` rather than matched for
  a literal, so it cannot freeze at an old figure.

⭐ **THE PORTAL ASKS WHICH SIDES, NOT JUST HOW MANY** (added 2026-09-06, OPT-02). This
reverses part of a decision made the day before the count-only design shipped —
worth reading both halves in order, because the second is not "the first one was
wrong," it is a second, narrower question the first one never claimed to answer.

- **2026-08-19, count only.** Addie: *"we need it to say 1, 2, 3, or 4 sides of the
  house ... so we dont have to guess if its the left or right side."* Her sheet had
  said "2 sides" for years; asking a member WHICH two would have invented a fact
  nobody had ever recorded, so `houseSides` became a plain count (1–4), read
  identically by `portalSideCount` (index.html), `houseSideCount` (admin.html), and
  `asCount` (functions/index.js) — all three tested against each other in Suite 63.
- **2026-09-06, named sides too.** Addie, asked directly how the crew is supposed to
  find the right side of the house from a bare count: *"how are we supposed to know
  which sides they want if it just says how many sides they want ... that's why we
  need them to say which side of the house they want done from were there front
  door stands."* This did not reopen the first decision — a count nobody ever
  recorded is still not manufactured for the ~956 existing records, so Edit and Add
  Customer still ask for nothing more than the count, unchanged. It answers the
  narrower question the count was never meant to: for a customer standing in their
  own portal, right now, which sides.
- ⚠ **Additive, not a replacement.** `houseSidesList` (an array of `Front`/`Left`/
  `Right`/`Back`, oriented "as you stand at the street looking at your house") is a
  second field beside `houseSides`. The count alone still drives price and the
  re-quote flag exactly as it did before this shipped — nothing about that mechanism
  or its Suite 63 tests changed. A customer with a count on file but no list yet
  simply has "which ones is not on file" instead of a blank, never a claim that
  nothing is set.
- ⭐ **AND LEFT/RIGHT ARE READ FROM THE STREET** (2026-09-07, OPT-03). Addie: *"we should
  be calculating left or right from the street not the front door."* **The two viewpoints
  are mirror images**, so this decides which half of a roof is lit — standing at the door
  looking out, your left is the other side of the house. Street-facing is also the only
  reading the crew can act on, since they arrive at the kerb. The first version of the
  copy named no viewpoint at all for the two words that need one ("as you stand at the
  street" and then "Left/Right follow from there"). Nothing needed migrating: no house
  had been asked before the day it shipped. The Edit Customer note repeats the convention
  whenever a side that has a hand is named, or Left there and Left in the portal are
  opposite sides of one house.
- ⛔ **SWAPPING LEFT FOR RIGHT WAS NOT A RE-QUOTE, AND NOW IT IS** (OPT-04 on 2026-09-07,
  reversed by OPT-06 on 2026-09-10). Both are Addie's. The old ruling — *"For left and
  right side of the house on quoting those should usually be the same"* — is kept here
  because it is still right about what it was asked: the PRICE does not move, two sides
  of one house being near enough the same length. The new one answers a different
  question with the same words: *"A swap will be a requote cause we need to remark it."*
  A swap changes which roofline the crew hangs, somebody has to be told, and a re-quote
  is the only thing in this system that tells them. The *usually* in the old ruling was
  carrying the whole exception, and the exception turned out to be the common case.
- **The portal's Sides tab is checkboxes, not radios.** `tabPanel-sides` now shows
  four ticks (`class="portal-side-pick"`, `value="Front"` etc.) instead of the old
  four-radio count picker. `portalSidesPickedList()` reads the ticks and
  `portalSidesListFromValue()` sanitizes to `PORTAL_SIDE_NAMES`'s fixed order —
  dedup'd, capped at four, and stable regardless of tick order — so a record always
  compares and displays the same way it was saved, whichever order that was.
- ⚠ **The confirm dialog fires on a COUNT change, never on naming alone.** The common
  first save, for every one of the ~956 existing customers, is filling in WHICH
  sides for a count that was already accurate — that must not trip the same
  "you will be re-quoted, price may change" warning as an actual count change nobody
  asked for. The save handler compares both `pickedList`/`beforeList` (did the names
  change) and `pickedCount`/`beforeCount` (did the count change) for the "nothing to
  change" case, but only opens the confirm — and only creates a new `quotes`
  re-quote doc — when `pickedCount !== beforeCount`. This mirrors, on purpose, the
  server's own re-quote condition (`asCount(updates.houseSides) !== before`) rather
  than inventing a friendlier rule that could disagree with it.
- ⚠ **Validated server-side, same discipline as the count.** `portalSave`'s `sides`
  section reduces whatever array a browser sends to the four known names, in
  canonical order, dropping duplicates and anything unrecognized — a stray value or
  a doubled tick must not reach a crew card. **The list wins the count when both
  arrive**: `updates.houseSides = sanitized.length` after the list is cleaned, so a
  stale page or a tampered request sending a mismatched count and list is resolved
  in favor of the list, which is the one a person actually ticked box by box. An
  empty list after sanitizing deletes `houseSidesList` rather than storing an empty
  array, and falls back to the count the request carried.
- **Scoped to the Member Portal only, on purpose.** Add Customer, Edit Customer, and
  the quote-conversion side-picker are untouched — Addie's request was framed as "in
  member portal," and those three sit over records nobody has been asked, where a
  default or an invented list is exactly the mistake 2026-08-19 was written to
  avoid.
- ⭐ **AND THEN THE OFFICE GOT THE SAME FOUR BOXES** (2026-09-10, OPT-05). Addie: *"in
  costumers it says sides of house 1234 which we can keep but can we also choose which
  sides like front,left side, right side, back in costumers?"*, then *"Then sides will
  automatically choose based on how many sides we chose"*, then *"if I choose a new side
  on someones house which should be multiple choose then it will send the house to
  requote indicating New Side."* **This supersedes the bullet above** — Add Customer and
  Edit Customer now write `houseSidesList`, and Edit Customer's read-only "From their
  Member Portal" line is gone, replaced by four tick boxes. The old reasoning is kept
  because it is still the guard: nothing is filled in by OPENING a record, so a phone
  number corrected on a house nobody has been asked about still saves with no list.
  - **The count and the four names are one answer.** Picking a count ticks the sides
    that count means; ticking boxes moves the count to match. The count is what drives
    the price and the re-quote flag, so it can never be left saying something the ticks
    contradict — the state that shows a customer an identical Now/New line in their own
    portal and then files a re-quote nobody asked for. Unticking everything leaves the
    count alone: nought is not a house, and an empty list is the form saying *which*
    sides are not on file, not how many there are.
  - **The fill order is Addie's own, from 2026-08-18**: *"3 sides then front of house,
    right side of house and left side of house is all checked."* Front, then right, then
    left, then back — the same order `rbSidesFromNote` already reads her sheet in
    (`RB_SIDE_ORDER`). ⚠ The boxes are DRAWN in that order rather than in the canonical
    storage order, because a fill that visibly skips the second box reads as a bug. What
    is STORED is still canonical `Front/Left/Right/Back`, the order the portal and the
    server both sanitize to.
  - ⚠ **An auto-fill is not the guess 2026-08-19 refused, and the difference is that a
    person can see it.** A count picked in the office moves four boxes on screen in front
    of whoever picked it, and they can change any of them before saving. What that
    ruling refused was a list invented for records nobody had been asked about — which
    is why opening a record still fills in nothing.
  - **Adding or removing a side raises a re-quote from the office**, labelled **New
    side** (or **Fewer sides**) on the quote card, and the card says *the office changed
    this — they have not been told*, because Edit Customer tells the customer nothing
    while the portal warns them. ⚠ **A same-count swap does not** — OPT-04 stands, and
    the office condition is the count, exactly the condition the server applies to the
    portal's own sides save, so the two routes into a re-quote cannot disagree about
    which changes cost money.
  - ⚠ **A stored list that does not fit the count is not shown and is cleared on save.**
    That state was reachable before this form could write the list. The count wins here
    and the list wins on the server, and both are right: each defers to whichever answer
    was given most recently.
  - ⭐ **AND THE BOXES OPEN FILLED IN** (2026-09-10, OPT-07). Addie: *"can you fix record
    fills nothing in?"* A house with no names on file opens showing the sides its count
    means, front first. **This reverses what shipped hours earlier**, and the reversed
    reasoning is kept because it names the real cost: this form is opened dozens of times
    a day for reasons that have nothing to do with lights, so a saved record now carries
    a front-first guess unless somebody corrects it. Two things make that affordable and
    **neither is optional** — filling in a blank does not count as a change (so none of
    it raises a re-quote; without that clause it would post a quote card for the whole
    book), and the line under the boxes says *nobody has said which sides — these follow
    the number above*, so a guess never wears the words of an answer. A stored list that
    fits the count is shown as-is and the note then says it is what is on file.
  - ⭐ **WHAT COUNTS AS A CHANGE IS ONE RULE IN THREE FILES** — `houseSidesChanged`
    (admin.html), `portalSidesChanged` (index.html), `houseSidesChangedServer`
    (functions/index.js). A count change is a change; a swap at the same count is a
    change (OPT-06); filling in a blank, or losing a list, is not. ⚠ It decides whether
    somebody is re-quoted, so the three copies are **swept against each other over 576
    combinations** in Suite 313, the way money-parity sweeps the invoice maths, and the
    sweep asserts they are RIGHT as well as equal. Change one, change the other two, in
    the same push. ⚠ All three compare the lists as joined strings, so every caller
    sanitizes to canonical order first.
  - ⭐ **AND IT IS ONE FIELD BOTH WAYS** (2026-09-10, OPT-08). Addie: *"any changes to
    what side on member portal should go to requote and update in costumer. And vice
    versa any changes in costumer should show in member portal."* This was already true
    and is now asserted: `portalSave` writes `houseSidesList` onto the customer record
    and Edit Customer reads it straight back, and the field is in `PORTAL_READ_FIELDS`
    so the office's own answer ticks the customer's boxes. ⚠ **That whitelist fails
    silently** — drop the field and the Sides tab opens blank for everybody, which reads
    exactly like a customer who has never answered, so the office would set the sides,
    the customer would see none, and each would think the other was wrong. Checked by
    name for that reason.
  - Proved by Suite 313 (the four boxes, the fill order, the wiring, the open-modal read
    AND its note, the three-way sweep and the two-way field, all *run* against jsdom
    holding the page's own markup) and Suite 108 (the save handler, *run*: the list is
    written, a new side raises a re-quote carrying both counts and `by: 'office'`, a swap
    raises one too but is not labelled *New side*, naming a blank house raises none, and
    an untouched form writes nothing).
- Proved by Suite 63 (repointed for the checkbox UI and the count-vs-list save
  logic) and the new Suite 309 (the server-side sanitize step, *run*, not regexed:
  canonical ordering, dedup, the list overriding a mismatched count, and the
  empty-list fallback).

⭐ **AND THE CREW IS FINALLY TOLD WHICH ONES** (2026-09-11, [[OPT-09]]). Addie: *"for
sides can you mention which side they want looking from there street? so is it left side
from looking at your house from the street kind of thing."*

- **What was wrong.** Every screen above learned the names and the printed sheet never
  did. Its Sides column called `printSideCount`, which returns the COUNT — so a house
  that had said Front, Left and Back reached the kerb as the number **3**, and this is
  the season the crew works off paper alone. That is [[OPT-02]]'s own question — *"how
  are we supposed to know which sides they want if it just says how many"* — still
  unanswered in the one place it is asked.
- **`printSidesCell`** (renamed from `printSideCount`, because the old name no longer
  described what it returns) prints the names when `houseSidesList` holds exactly as
  many as the count, and the number otherwise. ⛔ **It never prints a list that does not
  fit the count** — two names under a count of three is a claim that cannot be true, and
  records really can be in that state because the count is far older than the list. The
  count wins, the same way round as [[OPT-07]]; a list trimmed to fit would be an answer
  nobody gave.
- **The viewpoint is on the column and on the labels**, not in a note beside them. The
  heading reads **Sides (from street)**, and Add and Edit Customer's tick boxes read
  *Left side (from the street)* / *Right side (from the street)*. [[OPT-03]] settled that
  left and right are read from the street and the portal says so in a sentence; the
  office's boxes said it only in grey text underneath, and paper carries no note at all.
  The two readings are mirror images, so the word alone decides which half of a roof gets
  lit by a coin toss.
- ⚠ **Nothing about the stored values changed** — the four names, the count, the
  re-quote rules and every gate on them are untouched. This is what is SAID, not what is
  kept.
- Proved by Suite 104, *run* against the real helpers (the names on the sheet, the
  fallback to the number, a mismatched list, a value nobody offers, and the heading), with
  the crew-sheet fixture given a list so the check cannot pass on the old behaviour.

⭐ **THE PORTAL SAYS WHEN A BALANCE IS ACTUALLY DUE** (added 2026-09-02, MON-57). Addie:
*"I want to make it clear to the member that this is there payment however they do not need
to pay until after they get an invoice from us."* The payment card said **Current Balance**
from the moment a house was priced — months before the nightly run bills anybody — so a
customer signing in during October read a figure that looks due today, above a pay button.
Until the bill goes out the label reads **Your Price This Season**, and the customer is told
in as many words what the number is and when it is due.
  - ⭐ **IT IS A POP-UP, AND ONLY ON RSVP APPROVE** (changed 2026-09-03, MON-59 then
    MON-60). It shipped as an inline box under the amount; Addie asked for it to be louder
    — *"make it more obvious... like a popup"* — and then, having seen it fire on every
    ordinary sign-in, *"This should only pull up when they push RSVP Approve. It should not
    pop up every time they open there member portal."* It is `#portalPriceModal`, raised
    only by `openPortalAfterYes` — the RSVP email's yes branch, which is "RSVP Approve" in
    the one sense this codebase names. One dismiss button, never a second **Pay now**: the
    real pay buttons are already on the same screen.
  - ⚠ **THE LABEL IS NOT GATED BY THAT.** "Your Price This Season" still replaces "Current
    Balance" on an ordinary sign-in — only the interrupting dialog is scoped. Somebody
    signing in normally reads the right figure under the right heading; they are simply not
    stopped to be told it.
  - ⚠ **THE DEFAULT IS SILENCE.** Every other way into the portal — a phone-and-name
    sign-in, a saved-token auto-login, the post-payment RSVP ask, the in-portal Changes tab
    — passes nothing, so forgetting the flag means *never shows* rather than *shows every
    time*. That is the cheap direction to be wrong in.
  - ⚠ **It sits BELOW the gate-code dialog and the arrears lock** (z-index 399 against 400
    and 401). All three can be raised on one portal load; the other two outrank it — one is
    a question they must answer, the other blocks the season.
  - Driven by `billIssued`, a boolean `portalInvoice` derives from the invoice's own
    `invoicedAt` — the same stamp the due date and the Overdue flag are measured from, and
    the one Start New Season clears, so it answers about *this* season.
  - ⚠ **It never hides the pay buttons.** Paying early is real and allowed.
  - ⚠ **It is silent when they owe for last season.** A carried debt is on this year's bill
    before this year's bill is issued, so the flag is honestly false while the money is
    payable *now* — and that customer is being held off the schedule until they pay it.
  - ⚠ **Read as `=== false`, never `!billIssued`.** A field that never arrived means *we do
    not know*, and telling somebody holding a real invoice that they need not pay it is the
    expensive way to be wrong.

⭐ **A RETURNING CUSTOMER IS ONLY BUILT FOR IF THEIR SET ACTUALLY CAME BACK**
(2026-09-03, WH-24). Addie, after confirming one customer for the season and finding him
on the warehouse list: *"it should only be sent to warehouse if there is any sort of
change from last year. If nothing changes than nothing is affected."*
  - **What was wrong.** Four places — the office RSVP dropdown, quote approval, the RSVP
    link, and the shared season rule on both sides of the wire — asked
    `was 'no' && !needsLightRecycle` and read the **cleared** flag as proof the warehouse
    had pulled the bundle apart. It is equally clear when **nobody ever queued a
    recycle**, which is the ordinary state of somebody marked no by hand or by an import.
    Confirming them then built a second bundle for a house whose first was on the shelf.
  - **What decides it now.** `rejoinNeedsBuild` (admin.html) and `rejoinNeedsBuildServer`
    (functions/index.js) require `lightsRecycledAt` — the stamp every completing recycle
    writes. A queued recycle still means "the warehouse owns that bin, leave it alone".
  - ⚠ **The strict direction has a cost, taken knowingly.** A recycle completed before
    that stamp existed leaves no evidence, so that customer returns with no build queued
    — a crew at an empty bin, which is the worse failure. Accepted because the population
    is empty in practice: a plain no **deletes** the record, the keep-them path has always
    stamped, and the crew portal is unused this season. If a house is ever hung with
    nothing built, this is the line to look at — do not go back to reading the flag.
  - ⚠ **The badge was never broken.** No badge on a warehouse row means `lightsChangedAt`
    is unset — nobody has changed those colours, through any door. That is how this was
    diagnosed.

⭐ **AND A HOUSE CAN BE TAKEN OFF THE BUILD LIST WITHOUT CLAIMING A BUILD** (WH-25).
**Not needed**, beside Mark Done on the warehouse row. Mark Done stamps
`lightsMarkedBuiltAt`, so it was the only way off and using it dated a bundle nobody
made. This clears the flag and the queue date, stamps nothing, asks first, and writes the
reason to the activity log. It leaves `buildTopUpFromFeet` and `binLabelNumber` alone —
those describe a bundle actually made or a bin actually labelled.

**Last season's unpaid bill is carried, not written off** (2026-08-31, MON-31/MON-32).
Start New Season used to write `install: newInstall, deposit: 0` over every invoice, so a
customer who never paid opened the new season owing this year's charge and nothing else —
the debt gone from the books for all ~967 customers, surviving only inside a
`yearlySnapshot` nothing bills from. It is now carried onto the new invoice as **its own
line in the fee ledger**: a `changeFeeNotes` entry with `kind: 'arrears'`, reading
*"Unpaid balance carried from the 2026 season"*, worth whatever `balanceDueAmount` said
was left. Nothing about the formula above changed — the ledger was already counted
everywhere, already survives both invoice rebuilds, already prints as its own row on the
invoice, and already reaches the customer's portal.

⭐ **A DEBT CAN ALSO BE TYPED IN BY HAND** (added 2026-09-01). Both automatic routes read a **saved snapshot** — Start New Season carries the balance it sees at reset, and the Arrears Backfill repairs seasons reset before 31 August. A debt from a season with no snapshot behind it could be recorded nowhere. **Edit Customer → "Owed from a previous season"** fills that gap: amount + which season, saved with the rest of the form.
  - ⚠ **It is tagged `source: 'office'`**, and that tag is what lets a typed-in debt and an automatically carried one coexist on the same invoice. The Edit Customer rebuild drops only `manual` fees and only `arrears` lines the office typed, so a balance Start New Season worked out from the books **survives an ordinary save**.
  - ⚠ **The Fees box beside it cannot do this job.** A manual fee raises what they owe and does **not** hold them out of the season — so a crew would still be sent.

⭐ **A CARD GOES RED WHEN SOMEBODY IS SERIOUSLY BEHIND** (added 2026-09-01). Addie: *"turn everyone that hasn't paid from last year or is 60 days over there payment as red for there card."* In **All Customers**, a row gets a red left bar and a pink tint when either is true:
  - they **owe from an earlier season** (`houseOwesFromLastSeason` — the same rule that holds them out of the season, so the card and the hold can never name different people), or
  - their bill is **past 1 April** and is still not settled — the morning the late fee lands. (⚠ **Changed 2026-09-11 with the payment terms.** It used to be 60 days after the invoice, which under 30-day terms meant "a month past due" — the shape she asked for when she said *"no 60 days after invoice goes out"*. Moving payment to February kept the shape and broke the arithmetic: sixty days after an October invoice is December, so the whole book would have gone red over Christmas while nobody was late at all.)
  - ⚠ **It is not the Overdue flag.** That one turns on the day after the invoice's own due date at the end of February; this one waits the further month Addie gives them before a fee. Reddening everybody on 1 March would say nothing the Overdue column does not already say.
  - ⚠ **Paid in full is never red**, whatever the dates say, and neither is a bill that was **never issued** — that has not gone out, so there is nothing to be late for.
  - ⚠ **A bar and a tint, not red text.** The row already uses colour for the RSVP and invoice pills; recolouring those makes an overdue customer's answers unreadable.

⚠ **"CARRY" IS NOT A STEP THE OFFICE TAKES.** Addie, questioning it: *"I still don't see the use for carry I just think that should just stay on there account until they pay."* That is exactly what happens — carrying is the *mechanism* by which the debt stays on the account, run automatically inside Start New Season's invoice reset. Without it the reset zeroes the debt along with everything else. The one-off **Carry** button in the Invoices tab is not an ongoing tool: it repairs only seasons reset before 31 August, when the reset wrote debts off. Once used, or once it reports nothing to repair, it is finished.

⭐ **THE YEAR ON THAT LINE IS PINNED TO THE DEBT, NOT TO THE CALENDAR** (added 2026-08-31). Addie: *"if it is 2028 but they haven't paid in 2025 than that does not change every year."* The arrears note carries its own `year`, stamped the first time the debt is carried and **preserved on every reset after that** while it stands. Relabelling it each season would erase how old the debt is — which is the one thing that tells the office whether to chase it or write it off.
  - **Earliest year only, for the whole lump sum.** A customer unpaid across several seasons shows the year they *first* fell behind. That falls out for free from there being exactly ONE arrears note per invoice — Start New Season **replaces** it rather than appending — so "the note's year" and "the earliest unpaid year" are the same fact, as long as it is preserved rather than rewritten.
  - **A note written before the field existed reads its year out of its own sentence** ("Unpaid balance carried from the 2025 season"), rather than showing blank on an invoice nobody has touched since.
  - **It shows in four places**, all from `arrearsYearOnInvoice` / `houseArrearsYear` so they cannot name different years: the reason a customer is held out of the season, the Unpaid badge on their row, the invoice status cell, and the held-customers list.

**After they pay last season**, the invoice is re-read and the chooser rebuilds from it:
the last-season option disappears and the payable figure becomes what is left of this
year. ⚠ `portalPayableNow` falls back to the whole balance when the carried amount is
gone — the scope is still `arrears` at that moment, so a naive read returns 0 and shows
the customer nothing to pay. A part payment leaves the option up for the remainder
(MON-52).

⚠ **Changing the amount takes the PayPal buttons down and puts them back** — because the
card button creates its order when the inline form OPENS, not when it is submitted. Once
that form is up it is bound to the amount chosen before it, and nothing in the browser can
revise an order PayPal has already created. Every control that changes what will be
charged (the choice, the tip buttons, a typed tip on leaving the box) calls
`resetPaypalButtons` (MON-50).

**Paying it: one season at a time.** While last season's carried balance is outstanding,
the portal's payment button charges **exactly that** and says so in words — the season it
is for, that it is *not* a second charge for this year, and what this year's amount will
be next. Once it is paid the same button comes back offering this year's. The customer is
never asked to type an amount, so "did they pay in full" is never a judgement call
(MON-37). `arrearsOutstanding` in js/money.js and `arrearsOutstandingServer` in
functions/index.js are swept against each other by money-parity — this one decides what a
card is actually charged.

**Entering a debt from before the app tracked it:** Edit Customer → *Owed from a previous
season*. It writes the same kind of carried line, so it holds them out of the season too.
The Fees box cannot do this — a manual fee raises the bill and does not hold anybody
(MON-36).

⚠ **The backfill button is NOT a pending task** (MON-51, 2026-09-01). Addie: *"I'm not
going to do carry cause we did not have this website last year there is nothing to
carry."* The book only started on this site, so no invoice carried a 2025 balance for the
snapshot to hold. **Nothing is carried today** — the hold releases everybody, Owes from
last year is empty, and the two-button payment choice never appears. It all begins working
by itself at the END of this season, when Start New Season carries anyone who has not paid
for 2026. Do not chase her to press the button.

⚠ **The 2026 season was reset before this shipped**, so those balances were written off
and survive only in the snapshot. **Invoices → Start New Season → Carry last season's
unpaid bills** is the one-off repair: it reads the snapshot, shows what it would do, and
on a typed CARRY writes the same `kind: 'arrears'` lines the reset now writes itself. It
skips anyone already carrying a line — re-checked against a fresh read at write time — so
running it twice cannot double a debt (MON-33).

**And they are not scheduled until it is paid** (RS-24/RS-25). Addie: *"If they didn't pay
last year they should not be scheduled to be hung."* `isOutForSeason` asks
`houseOwesFromLastSeason`, so a debtor gets no crew, no bundle and no route **even if they
RSVP yes** — a yes is not a payment. Money is read oldest-debt-first, so "have they paid
for last year?" is one subtraction: paid plus credits against the carried amount. A
part-payment releases nobody (*"needed to pay 800 and paid only 400... we cannot schedule
them"*). There is **no override button**; the hold lifts when they pay, or when the office
credits the amount off, which is money on the invoice rather than a hidden flag.
Everybody held is named, with the amount and a phone number, under
**Schedule → Owes from last year**.

⭐ **AND THE CUSTOMER IS TOLD, ON THE RSVP, RATHER THAN PROMISED A CREW** (added
2026-09-01). This is the half that was missing. The RSVP confirmation ended on *"We'll
get you scheduled!"* — so the one group guaranteed **not** to be scheduled was the one
being promised an install. Nothing on either side said otherwise: the office saw them
under Owes from last year, the customer saw a tick and a thank-you, and the two only met
in December in front of a dark house. A yes from somebody carrying a debt now reads
*"we've got your yes"*, then the amount, the season it is from, and that we cannot book
the install until it is settled; the button offers the balance instead of a generic
portal link. **Both** screens changed — the follow-on *"That's all, thanks"* message was
where the promise actually lived, and fixing only the first would have left it as the
last thing they read.
  - ⚠ **Their yes is still recorded.** `portalRsvp` writes the answer before this screen
    is drawn. RS-24 holds them on the money, never on the answer.
  - ⚠ **This is not MON-34's automatic chase**, and the distinction is the whole of why
    it was safe to build. Nothing is *sent* — no email, no text, no note. It is one
    sentence on a page the customer opened themselves, and MON-34's own reasoning
    already rests on them being able to *"see and pay it in their portal"*.
  - ⚠ **Silence is the fail-safe here**, deliberately the opposite direction to the
    season hold. `portalRsvp` returns `arrearsOutstanding` from the shared rule and
    reports nought if the invoice cannot be read, which leaves the original wording
    untouched. Holding somebody who paid costs them their lights; **telling somebody
    they owe money we cannot prove they owe is worse than not warning them at all**.
  - ⚠ **It reads the bill the house is ON** (`billToPhone` before the house's own key),
    which is RS-24's rule verbatim: if Dana pays for Kyle and Dana did not pay, Kyle's
    lights were not paid for either.
  - ⭐ **And the same is true of the second door: approving a quote.** For an existing
    member `quoteRespond` writes `seasonYesUpdates`, so approving **is** a yes and RS-24
    holds them exactly as it does an RSVP yes — while all three approval endings promised
    an install. Fixing one door and leaving the other is half a fix, and would leave two
    screens making opposite claims about one rule. `arrearsForCustomer` on the server is
    the one lookup both doors call; `quoteScheduleSub` in index.html is the one wording
    rule all three endings call. It reports nought — so the original wording stands — for
    a decline, and for an approver we cannot identify (`alreadyMember` is deliberately
    wider than `memberRef`: a quote can say "this became a customer" without saying who).
  - Proved by `test/rsvp-arrears.spec.js` (twelve browser checks — every claim is words
    on a screen) and the `portalRsvp`/`arrearsForCustomer` sections of
    `arrears-hold.test.js` (the server half, which no browser spec can reach).
    19 sabotages red-checked.
    - ⚠ **Two of the three quote endings are only covered structurally**, and that is
      stated rather than glossed: the member "keep everything the same" ending and the
      portal's own `quoteApprovedMsg` need stub shapes the suite does not build, so all
      that is asserted is that they still route through `quoteScheduleSub`. That catches
      a revert; it does not prove what renders.

⚠ **`houseArrearsOutstanding` asks `arrearsOutstanding` from js/money.js** rather than
subtracting for itself. It hand-rolled `owed - (deposit + credits)` in plain floats while
the shared rule works in whole cents — the guard above it meant the two could not yet
disagree, but a second copy of a money rule is what this repo forbids, and the next change
to the rule would have moved only one of them.

⚠ This is **not** `houseIsOnTheBill`, which decides who is *charged* — and for these
customers that answer is emphatically yes. Folding the two together would write the debt
off again by the back door.

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
| `routeSchedule` | **The Schedule tab's whole saved season**, one document (`routeSchedule/plan`). Distinct from `scheduledRoutes`, which is the crew's frozen day sheets — see §5 |
| `archivedCustomers` | Customers removed to the recycle queue. The customer is **nested** (`{customer, archivedAt, archivedBy, reason}`), which has caught a sweep out before |
| `activity` | The activity log — one row per office action, keyed by `refId` so a customer's history can be read back. This is what still records a route sweep on the spot now the inbox note is a daily digest |
| `payments` | The payment ledger — one row per payment received, keyed on `invoiceKey`. Append-only in practice; `logPayment` refuses a zero |
| `unmatchedPayments` | A card capture that succeeded with no invoice to apply it to. Staff-readable, `allow write: if false` — see *"A payment that finds no bill"* below |
| `healthCheckDecisions` | Health Check's *Fix this one* / *Not a problem* answers, fingerprinted on check + member + values so a decision lapses when the numbers move |
| `ruleDecisions` | Approve/deny on a rules finding. Deliberately **not** a second copy of the rulings — only the decision, its fingerprint, who and when. `claude/questions-map.md` stays the one place a ruling lives |
| `yearlySnapshots` | One document per season, written by Start New Season before it resets anything: every invoice as it stood. Read back immediately, because "the write resolved" is not "the data is there" |
| `adminUserPrefs` | Per-signed-in-user dashboard preferences (`adminUserPrefs/{uid}`) — the only per-user collection here |
| `houseMaps`, `inventoryItems`, `smsTemplateFolders`, `smsTemplates`, `employeeMessages`, `teamMessages` | Present in the rules; no direct usage found in this pass in the three HTML files — likely legacy/reserved |

**Read/written only by Cloud Functions** (Admin SDK, bypass rules entirely — this is *how* the public site touches protected data without being logged in):

| Collection | Purpose |
|---|---|
| `portalRateLimits` | Sign-in / lookup attempt counters, to slow down guessing |
| `nightlyInvoiceLog` | Log of nightly billing runs — staff can read it, only the function writes (`allow write: if false`) |

⚠ **THE NINE ROWS ABOVE `routeSchedule` DOWN WERE MISSING UNTIL 2026-08-30**, under a
heading reading *"Every Firestore collection"*. `routeSchedule` holds the entire Schedule
tab; `payments` and `unmatchedPayments` hold money. Nothing checked the table, which is
why "every" drifted — the same code-back-to-the-list gap found the same day in the portal
whitelist. `collections.test.js` (`npm run test:collections`) now sweeps every collection
touched in the four source files against this table, and every name in
`firestore.rules` against the code.

`jobAddresses`, `invoices`, `quotes`, `messages`, and `scheduledRoutes` are touched by **both** sides — staff directly (authenticated), and the public/portal side only through Cloud Functions.

---

## 5. Routes in detail

**Candidate pool**: unscheduled, not completed, geocoded (has lat/lng), not locked by install-preference or an earliest-install date, not `lightsLocked`, and RSVP `'yes'`. Selection uses a greedy nearest-neighbor walk from a seed house (by chosen direction — east/west/north/south/dense/auto), then a 2-opt pass to tighten the order.

**Saved as a frozen snapshot** (`scheduledRoutes/{date}_{type}_{crew}`): each stop only freezes `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber`. Everything else (notes, wire color, light pattern, house photo, one-time note) is looked up **live** from `jobAddresses` when the route is displayed — on purpose, so a correction after scheduling still reaches the crew for those fields.

**Resync when a customer is corrected later**: two parallel implementations — one in admin.html (staff edits), one inside the server-side `portalSave` (customer edits their own info) — both scoped to **upcoming routes only** (a route dated before today is left alone as history).

**Crew side**: Today's Route in the Crew Portal loads `install` and `fix` type routes for the day. Marking a stop Done clears the one-time note and stamps `completedAt`. "Didn't Get To" sends the house back to the schedule pool with no invoice sent. *(Removal-day routes are generated and saved in Admin, but the Crew Portal's Today's Route loader only queries `install`/`fix` — worth confirming with whoever runs removal day whether they use a different screen, or whether this is a gap.)*

**The reconcile sweep, and the one answer to "what town is this day"**: the sweep evicts stops that no longer belong (`stopProblem`), caps days that run over the crew limit (`evenOutDays`), then tops up short ones (`fillDays`). All three judge a house against **`routeDayTowns(day)`** — the day's full allowed town list (`day.towns`, falling back to `day.city`, so a route saved before `towns` was stamped behaves exactly as it always did) — and judge the house itself through `extractCleanCity`, the same cleaning step 1 uses. They used to disagree: eviction read the allowed list while the cap and top-up read `routeCityOf()`, the *commonest* town actually on the day. On a day stamped one town but carrying a legitimately borrowed house those two return different towns, so step 1 evicted a house and step 3 put it straight back — every sweep, indefinitely. `evenOutDays` and `fillDays` take the town lookup as an optional last argument; omit it and both behave precisely as they did before.


**A town that is really a street**: `townIsPhantom(town)` is the one rule — the town looks like a street (`cityLooksLikeStreet`) **and** it is not on the office's own nearby-towns list (`NEARBY_TOWN_LIST`), because a town the office has typed and paired up is a town however oddly it is spelled. Three places ask it and none keeps a second opinion: `planNewCrewDays` skips such a town when it groups houses into candidate crew-days, so no day is ever seeded from one; the reconcile sweep collects those houses into `stranded.badTown` and the notice names them with the value quoted; and Health Check's *a town that looks like a street* row reports the same houses. It **reports, it never corrects** — about sixty places read what `extractCleanCity` returns (the route grouping, the schedule, every town dropdown and filter, the crew sheets), so quietly returning something different would re-file houses between towns everywhere at once. The suffix list deliberately omits Grove, Springs, Hills, Heights/Hts, Mountain, Fork, View, Cross and City: each is a real street type *and* the tail of a real Utah town, and with them in it flags Pleasant Grove, Saratoga Springs, Cedar Hills, Cottonwood Hts, Eagle Mountain, American Fork, Spanish Fork, Woods Cross and Pleasant View — nine real towns, six of them in `DEFAULT_NEARBY_TOWNS`.
*Naming*: `routeDayTowns` is deliberately **not** `dayTownList`. A separate `dayTownList` exists further down for the timing sweep, answering a different question about a different shape of object (a day of `.houses`, not a saved route). Two top-level declarations of one name do not coexist in a browser — the later one wins for the whole page.

**Duplicate System notices**: `reconcileNoteIsRepeat` suppresses a word-for-word identical "Routes Kept Up To Date" note inside an hour (`RECONCILE_NOTE_REPEAT_MS`). It is guarded twice — an in-memory record, and a scan of `allMessages` so a reload, a second tab or the other office machine doesn't reopen the hole. It suppresses the *notice*, not the sweep: a backstop, not the fix, and it logs a console warning naming the loop rather than going quiet.

### Three things that move somebody up a season

Added 2026-09-03. Dax asked for three new priorities and put two limits on all of them:
*"dont do someone in a month they dont want to be hung though and dont make a route that
is 100 miles longer because you were to worried about priority... a higher goal is to
shrink total miles."* All three land on **Recalculate everything** and nowhere else.

**1. The weather.** Before it lays anything out, that button fetches one Open-Meteo
request covering every town in the book (`loadSeasonForecast` — the same free, keyless
service the Routes tab's weather card already uses, about sixteen days ahead) and fills a
town→date→high table. `rebuildSeasonDays` hands the builder a plain lookup, so
`planNewCrewDays` stays pure and every test suite still builds a whole season offline.
Inside the builder there are **two rules and only one of them is hard**:

* **The cutoff is a veto — and it is 31°, not 35° (changed 2026-09-09).** Dax: *"31 degrees
  or lower in that area is vital and above 35 degrees can be prioritzed however you would
  like because its not essential but it is preferable."* A town whose forecast high for
  that date is at or below `COLD_DAY_MAX_F` (**31°**) is not offered the day at all. That
  is done as two passes rather than one more clause in the comparison, because of the
  *"unless"*: if nothing warmer has anybody waiting, the second pass runs with the veto
  lifted and the crew goes out anyway. The rule holds a crew back from the cold; it never
  holds them back from working.
* **32–35° is a strong dislike, not a refusal.** `COLD_DAY_CHILLY_F` (35°). A chilly town
  sorts *down* — ahead of the ordinary warmth bands, but still below urgency and below how
  full a day it can make — and can never be refused the day. The difference from a veto is
  exactly this: a vetoed town loses **even when it is the more urgent one**; a chilly town
  does not. Ruling **SCH-55**; SCH-44's cutoff half is superseded and the rest of it stands.
* **Warmth above the cutoff is only a tiebreak, and it is banded.** It sits *below*
  urgency and *below* how full a day the town can make, and it only fires when one town is
  a whole `WARMTH_BAND_F` (10°) warmer. Two Wasatch Front towns on one day are a degree or
  two apart; letting that decide would overrule *"the town with the most houses waiting"*
  — the rule the season is built on — on the strength of forecast noise.

⚠ **No forecast is not a cold forecast.** Most dates are past the sixteen days, and a town
with no located house has no place to ask about. Every one of those is "no opinion" and
the plan comes out exactly as it did before any of this existed. The season bar carries a
line saying which forecast the plan was laid out with, including *"laid out without it"*
when the service could not be reached — a plan laid out blind otherwise looks identical to
one laid out warm. The crew-days the *"unless"* could not avoid are counted and said out
loud, because a crew sent out at 30° reads as the rule not working.

**2. A day that was promised and did not happen.** A house going back in the pool off a
date that has already passed is a house the crew did not reach, and `rebuildSeasonDays`
writes that date onto it (`markHouseMissed`); the *"not all of them got done"* screen does
the same, which is a better signal because somebody typed it. `houseInstallPriority` then
gives them a **rank of their own at 15** — third overall, just behind new hangs and
asked-sooner (10) and ahead of every month (October is 30) — and the town with them in it
rises too, since a town's urgency is the best number in it, which is the *"higher priority
for where needs to be routed"* half of the ask.

⚠ **That rank changed on 2026-09-09 and the old answer is worth knowing.** Until then it
was a bump of five INSIDE the tier and never out of it, so a missed October house still sat
behind a new hang and a missed Any house still sat behind everybody who asked for October —
on the argument that being missed is a reason to go first among your equals and not a reason
to be given a month somebody else asked for. What that missed is WHY they are late: we named
a date and did not turn up. Dax, 2026-09-09: *"we want houses that were scheduled for a day
but werent to take priority just below new hangs and set priority customers because we want
to get to them as soon as possible because we told them theyd have lights on that day and
that didnt end up happening."* See ruling **SCH-61**; the month guard below is the half of
the old argument that is untouched and still holds.

⚠ **`Math.min(tier, 15)`, never a flat 15.** Being missed may only pull a house UP. A flat
assignment DEMOTES a missed new hang from 10 to 15 — the one way this change could have made
somebody later than they were before it, and the sabotage a red-check exists to catch.

⚠ **The tiers were respaced from 0,1,2,3,4 to 0,10,20,30,40,50 for exactly this.** With
nothing between them the only way up was into the next tier, which would have let a missed
October house outrank a new hang and a missed Any house jump the whole October queue. Ten
apart is what leaves room to rank something BETWEEN two tiers, which is exactly where the
missed rank of **15** now sits — between asked-sooner at 10 and the office's own typed date
at 20 — so it needed no respacing of its own. Nothing reads these numbers for their value;
every comparison is `<` or `>`, so the spacing can move and the ORDER cannot.
*(Respaced once more on 2026-09-09 — `-10,0,5,10,15,20,30,40,50,60` — to open a slot for a
date the office typed, two for a new member's own clock, and one for a house the crew never
reached. Nothing changed places; see **Closest to a date the office typed** below.)*

⚠ **It is recorded as a list of dates, not a counter.** Recalculate gets pressed twice in a
row and Undo puts the plan back so it can be pressed again; a counter would climb each time
and turn one missed morning into a customer who outranks the book. A list is idempotent,
and it lets somebody missed three times go before somebody missed once (`missed` is carried
into the builder's queue sort for that).

**3. A customer the office moves up by hand.** `rushInstall`, a checkbox in Edit Customer
beside the timing preference. It ranks **level with a new hang — not above one** (Dax,
2026-09-09: *"ask sooner is the same as new hangs"*), so it puts them at the front of the
queue the moment their town is being worked and cannot invent a day for them.

⚠ **This changed on 2026-09-09 and the old answer is worth knowing.** It used to be the
top tier, ahead of new hangs, on the argument that an override which cannot override is not
an override. What that missed is the cost: a rushed house outranked its own town, so one
phone call could pull a single customer onto a day whose crews were working somewhere else
— and a stop no crew can reach is a one-man trip. See ruling **SCH-49**, which supersedes
SCH-46.

⚠ **And it does not earn their town a crew-day** (added 2026-09-09). Dax: *"if someone
has priority that doesnt mean they will be done the very next day it means they will be
done the very next time it makes any sense in a route."* A town's urgency is the **best
number in it**, so one rushed house in a town of one made that town look as urgent as a
town holding thirty October houses — and it won a crew-day of its own on day one, which
is exactly how Darlene Price ended up alone on 1 October with a crew rostered for her.
`houseInstallPriority(h, cust, {forTown:true})` drops the rush flag, and that is the
number `allowedStats` scores a town on; the house's own queue position is unchanged.


⭐ **And a rushed house CAN move its area up, once the area can carry a day** (added
2026-09-09, [[SCH-64]]). Dax, asked directly: *"it can move their area up unless
something else is prioritizing above it."* The rule above shipped that morning as a
blanket refusal, and it was too wide: what he was looking at was a town of ONE scoring
as urgent as a town of thirty, so the fault was never that priority moved an area — it
was that the area could not fill a morning. Now that an area is a block of about twenty
adjacent houses, moving one up moves a real day, and the gate is `fillableCount`: nine
houses or more, derived from `ONE_MAN_MAX_HOUSES`, because below that a crew is a
one-man trip and that is the shape of the day he complained about.

⚠ The Darlene Price case is **still refused** — one rushed house on its own earns its
area nothing, and Suite 315 still asserts it. And *"unless something else is prioritizing
above it"* needed no code: a rushed house scores 10, a new member out of time scores 5
or -10, and the town pick already compares urgency first.

⚠ **The missed bump is deliberately NOT dropped with it.** A house the crew drove past
yesterday moves its town too — that is what was asked for, and the town really is more
urgent. Being asked to go sooner is not the same claim about the town. New hangs are
untouched in both. Ruling **SCH-54**.

⚠ **The two orderings read the flag in different places, on purpose.** The Schedule has a
new-hang tier, so `houseInstallPriority` puts a rushed house in it (10). The nightly sweep
has no such tier — new hangs are the sort key on the pool that feeds `fillDays` — so
`installPriority` no longer reads the flag at all and that sort does instead. They still
agree; each says it where it actually ranks.

⚠ **None of the three touches the month.** `houseAllowedFrom` and the office's own date box
(*Install Closest To This Date* since 2026-09-09; it was *Don't Install Before This Date*)
are untouched by any of them, so a November customer who is rushed, or who was missed, is
taken first on the first **November** day and not one day earlier. The box says so on screen.

The Schedule's day panel badges a rushed house **ASKED SOONER** and a missed one
**MISSED ×n**, and the button's summary names how many of each it moved — a customer who
quietly changes place in a season is what this office rings up about.

*Where it's proved*: run-all.js **Suite 300** runs the real builder against a cold snap and
the real ordering against fixtures; 24 sabotages were red-checked against it.
*Rulings*: [[SCH-44]], [[SCH-45]], [[SCH-46]], [[SCH-61]] in `claude/questions-map.md`.

### Closest to a date the office typed

Added 2026-09-09. The staff-only box in Edit Customer is now **Install Closest To This
Date** — it was *Don't Install Before This Date*, and it means both halves. Addie, asked
whether it should stay a floor, become a pure target, or sit beside a second field:
*"Still never before, but aim just after it."* Asked how close: within a week. Asked
calendar or working days: *"Working days."*

⚠ **The season planner had never heard of the field at all**, which is the part worth
knowing before anybody hunts a bug here. `houseAllowedFrom` read the customer's own
Install Timing and nothing else; the date was honoured on the **Routes** side only (route
generation, the nearby-house suggester, auto-scheduling a new customer), so a date typed
in Customers held the house off a crew route and did nothing whatever to the plan.

Three functions read one field, and it reaches them as `h.notBefore` on the house rather
than off the customer record — so each stays self-contained for the suites that lift it
alone:

* **The floor** — `houseAllowedFrom`. Unchanged in meaning: never before that day. **The
  later of the two dates wins, always.** A November customer with 12 October typed on them
  is still a November customer; the office date may move somebody later, never into a
  month they did not ask for.
* **The ceiling** — `houseDeadline`, via `staffDateWindowEnd`, five working days on
  (`STAFF_DATE_WINDOW_DAYS`). It sits **above** the preference branches and wins, because a
  house with 12 November typed on it and October on its own form would otherwise be handed
  a 31 October ceiling sitting *before* its own floor — and `packTailCrewDays` reads an
  impossible window as *"never move me"* rather than as a contradiction.
* **The place in the queue** — `houseInstallPriority`, tier **20**: behind new members
  (and, since [[SCH-49]], behind a rush install, which is level with them),
  ahead of October. Addie: *"New members come first... The staff dates should be second to
  these."* ⚠ This is **not** [[SCH-15]]'s named day. A customer who writes 11/9 on their own
  form is a wait, not a hurry, and stays at 40; the office typing a date is the same kind of
  act as ticking the rush box.

**A week is five working days everywhere in this feature.** The 72-hour warehouse hold
already skips weekends and Thanksgiving, so a ceiling counted in calendar days sitting
beside a floor counted in working ones would quietly shrink every window that crossed a
Sunday, and the two would disagree about the same customer.

**Time running out moves a house up, and the towns re-order themselves.** Nothing in the
planner had a clock in it — October was tier 20 on 1 October and on the 28th alike. A house
within `DEADLINE_PRESSURE_DAYS` (5) of its last allowed day, or already past it, now goes to
the front of **its own tier** (`deadlineIsClose`). Because a town's urgency is the best
number in it (`allowedStats`), its town rises for its next crew-day and the days rearrange
with nothing new deciding them — which is the half Addie actually asked for: *"if its almost
november and october has still not been done yet. We will rearange the days we are doing
those houses based on the costumers that urgently need to be done."*
⚠ **One bump, never two.** The missed-day bump and this one are an **or**, not a sum: five
is half the gap between tiers, and ten would land the house exactly on the tier above.

**A new member has a week, two at the outside.** Past `NEW_HANG_TARGET_DAYS` (5 working
days from conversion) they go to the front of the new hangs; past `NEW_HANG_LIMIT_DAYS`
(10) they go **ahead of everybody, rush installs included** — the only thing above tier 10.

⚠ **Read this beside [[SCH-49]], which landed the same day and pulls the other way.** A
rush install used to be the top tier and was demoted to 10 precisely because a top tier
could pull one customer onto a day whose crews were elsewhere. This puts something back
above it — and it is safe only because [[SCH-50]] closed that harm at the *day* level:
a house whose town is on neither crew's route is now rehomed rather than left there. So
this orders a house first without inventing a day for it. If that rehoming is ever
removed, this is the second thing that breaks.

⚠ **And a rush install no longer sits above a week-old new member** — it is level with an
ordinary new hang (10), so an overdue one at 5 leads it. Neither ruling addressed that
pair directly; it falls out of the two together, which is why Suite 315 asserts it rather
than leaving it to be inferred.

⛔ **Neither the office date nor the overdue-new-member bump moves a TOWN** ([[SCH-54]]).
A town's urgency is the best number in it, so one house at −10 would score its whole town
better than anything in the book and a town of one would win a crew-day of its own — the
Darlene Price shape arriving through a new flag. `houseInstallPriority(h, cust, {forTown:
true})` drops both, exactly as it drops the rush box. They still order the house the moment
a crew is going there, which is what *"ahead of everybody"* has to mean once a house cannot
earn its town a day. ⚠ **The deadline-pressure bump is deliberately NOT dropped** — a
deadline running out is a claim about the work, not about one phone call ([[SCH-45]]), and
[[SCH-58]] asked for the towns to re-order themselves in as many words. It is also how the
office date's own week still reaches the town: as that window closes, the house's deadline
does, and the town climbs.

⚠ **This one is an inference, not a ruling.** Dax's [[SCH-54]] named the rush box; Addie's
[[SCH-57]] and [[SCH-59]] were written before it existed and never mentioned towns. Reading
his rule as covering all three "a person decided about one customer" flags is the merge's
own judgement — it is the reading that cannot re-create the bug he had just reported, and
it is one line to flip if he meant it narrowly.

⛔ **The clock is gated on the new-member box, never on `tier === 10`.** Since [[SCH-49]] a
rush install shares that tier, and `newHangWaitDays` counts from `createdAt` — so a tier
test would hand −10 to every rushed customer on the book the moment the box was ticked,
because a returning customer was created seasons ago. That is a silent reversal of
[[SCH-49]] and a return of the stranding it was written to stop.

⚠ The **72-hour hold runs inside that week, not before it**: asked where the clock
starts, Addie said *"When they are converted to costumer"*, with the hold in front of her.
So roughly three of the five working days are spent held and the usable window is the back
half. That is the rule as given. ⚠ Measured from `createdAt`, which is safe only while no
importer sets `chargeNewMemberFee` — the bulk import stamped all ~945 houses with one
`createdAt`, and the last thing that measured from it flagged the whole book. A new member
with no `createdAt` is left exactly where they were.

**A cleared date clears the plan.** `notBefore` is the one entry in `SCHEDULE_SYNC_FIELDS`
carrying `blankClears`. The sync's standing rule is that a blank on the customer never wipes
what the plan holds — written for half-loaded records, and still right for the town, the
timing, the name, the phone and the notes. Here an empty box is a person deliberately
lifting a restriction, and Addie was asked directly. **Opt a field in; do not relax the
guard.** Without it a date typed once would hold the house for the rest of the season with
nothing left on screen to remove.

*Takes effect on* **Recalculate everything**, like the three above.
*Where it's proved*: run-all.js **Suite 315** runs the shipped functions in a sandbox — the
floor, the working-day ceiling across a weekend and across Thanksgiving, the tier order, the
single bump, the new member's clock, and the date travelling both ways through the sync.
*Rulings*: [[SCH-56]], [[SCH-57]], [[SCH-58]], [[SCH-59]], [[SCH-60]] in
`claude/questions-map.md`.

### How many crews there are, and what they are called

Addie, 2026-09-04: *"on schedule can you make it so we can add on crews and name them?"*

Schedule → the **Crews** bar at the top: one row per crew with its name and its town,
and beneath them **+ Add a crew** / **Remove &lt;name&gt;**. Naming has always worked;
adding is what did not. The same number is settable from Routes → **Crews out on a
normal day**, which is now a dropdown rather than a pair of radios — two radios could
only ever say one or two, so picking *Two* would have quietly dropped a third crew
somebody had already named.

**One number, in one place.** `settings/scheduling.crewsPerDay` is the whole answer to
"how many crews". It was already what the season builder, the tail sweep and
`surplusCrewDays` read, so both controls write it and the crew *list* pads itself from
it — the names ride with the plan as they always have, the length does not. Making the
list a second answer would put two numbers in two collections in charge of one fact, and
the day they disagree somebody is handed a sheet the season was never built for.

⚠ **A crew you add gets nothing until Recalculate everything is pressed.** The days
already built do not know about it. Both controls say so rather than leaving it to be
discovered from an empty sheet.

⚠ **Removing a crew that is holding houses on the day you are looking at is refused.**
Nothing would be lost — the towns are re-shared on the next render — but those houses
would move onto another crew's sheet with nothing said, and a sheet that changes under
somebody already holding paper is what the 48-hour lock exists to prevent.

⚠ **The ceiling was in two places and the second one was the quiet one.**
`normalizeCrews` mapped over a two-entry list, so a third crew could not exist; and
`loadSchedulingSettings` clamped the saved count to `(n === 1) ? 1 : 2`, so a third crew
that *was* written was read back as two **on the next login** — the season silently
rebuilt for two, one named crew got no day, and nothing anywhere went red.

**What follows the count now, rather than being written out as a pair:** which towns each
crew holds (`dayCrewTowns`), which houses land on which sheet and the 20/20 hand-back
(`dayCrewHouses`), how many crews a day actually wants (`dayCrewCount`, still capped at
the crews that exist), and which crew works a one-crew day (`daySoloCrew`, which now
falls back to the first crew when the stored one has since been removed — wrong about
*who* beats a printed sheet with nothing on it). The rules themselves are unchanged: a
crew is still its own town plus at most one neighbouring one, still twenty houses, and
the hand-back is still a hand-back rather than a leveller.

*Proved by run-all.js suite 304, which runs all of it — the two-crew answers are
re-asserted beside the three-crew ones, because the expensive failure is not "three does
not work", it is "three works and two quietly changed".*

### Why the forecast beside the map can be blank

Added 2026-09-10. Dax, looking at a day's two route maps: *"the only issue is I cant see
the forecast."*

**Nothing was broken.** Open-Meteo answers about sixteen days ahead. On 10 September the
season opens on 1 October — twenty-one days out — so no day in the plan had a forecast,
and every chip was correctly absent. ⛔ **But absent is not an answer**: "no forecast
yet" and "the forecast is broken" looked identical, and it took a bug report to find out
which.

An empty strip now says why, and the three reasons get three different sentences:

| why it is empty | what it says |
|---|---|
| the day is further out than the service answers | *"No forecast this far ahead — it reaches to Sep 25."* |
| the fetch failed | *"No forecast — "* and the error |
| in range, but no house in those towns is on the map | *"No forecast for Levan — no house there is on the map yet."* |

The first is a **wait** and says when to look again; the second is a **fault**, because
telling somebody to wait for a forecast that is never coming is worse than silence; the
third is a **data gap** the office can fix.

⚠ **The old rule survives where it was right.** A town with no number still gets **no
chip of its own** — a dash beside every unknown town is a row nobody reads. Silence per
town, an explanation per day, and the sentence appears only when the whole strip would
otherwise be blank.

⚠ **And the horizon is read off the table that was actually fetched**, never from
`FORECAST_DAYS` and a clock — those differ the moment the service trims its range or the
fetch is an hour old, and a promise about when the forecast arrives is worth nothing if
it is computed from a constant.

*Where it is proved*: run-all.js **Suite 314**. 6 sabotages red-checked.
*Rulings*: [[SCH-70]] in `claude/questions-map.md`.

### What the strip shows when there is no forecast

Added 2026-09-10. Dax, looking at a day in October on the tenth of September: *"I dont
see the forecast down here"* — with the strip correctly reading *"No forecast this far
ahead — it reaches to Sep 25."*

⛔ **[[SCH-70]] was right and still left him with nothing.** Teaching the blank strip to
explain itself was the correct answer to "is it broken or just early", and by the time
he read it he had stopped asking that. The season opens three weeks out and the free
service reaches sixteen days — so for **most of the season there is no forecast at
all**, and a strip that only ever shows forecasts is blank for most of the season no
matter how well it explains itself.

So past the horizon it shows what the weather usually does, from ten years of recorded
highs out of the same service’s archive:

| date | Lehi | Herriman |
|---|---|---|
| 1 Oct | ~71° | ~69° |
| 10 Nov | ~53° | ~52° |
| 15 Dec | ~39° | ~39° |

⛔ **A typical high is not a forecast, and the whole design turns on that.** It never
reaches `forecastHighFor`, `forecastIsCold` or the warmth band, so it cannot veto a
town, move a house, or count towards the cold-day tally. This repo has said since
`COLD_DAY_MAX_F` that *"no forecast is not a cold forecast"*; letting a ten-year average
refuse somebody a date would be that same mistake in a new costume — and it would do it
**quietly**, because every screen would still look right.

It is drawn so the two cannot be mistaken for each other: a tilde on the number, a
dotted outline, **no snowflake even at freezing**, and one footnote per strip saying
*"typical for the time of year, not a forecast"*.

⚠ **The curve is smoothed, and that is not a detail.** Measured at Lehi over ten years:
a single date averaged across all ten still swings **28°** between its warmest and
coldest year, and 15 November reads 56° raw against a seasonal trend of 50° — six
degrees of one warm autumn. A fortnight either side gives 150 samples a date, and
dropping half the years then moves the curve by at most **3.3°**. The smoothed number is
a season; the raw one is noise wearing a decimal point.

⚠ **Fetched once a day, and only for the panel.** Ten years of past weather does not
change between elevenses and lunch, and making Recalculate everything wait on ten
requests for numbers that change nothing about the plan would be pure delay in front of
the office. The forecast belongs in that gate; this does not.

*Where it is proved*: run-all.js **Suites 326 and 314**. 13 sabotages red-checked — and
the first pass caught only 11. Taking the tilde off the chip went green because the
footnote carries one of its own, and widening the window to 400 days went green because
the suite was reading the constant with a regex that never matched and silently grading
against a hard-coded 7.
*Rulings*: [[SCH-72]] in `claude/questions-map.md`.

### Why a route went far out at stop 11 and came back beside stop 2

Added 2026-09-10. Dax, reading a crew route off the map: *"1 2 3 4 5 6 7 can make
sense but the you get to 11 and youre way far out and then 12 is back where 2 was, so
it shouldve just been knocked out when you were there."*

Two faults, found in one sentence.

**The orderer could not move a stop.** 2-opt only ever *reverses* a run, so it can
straighten a crossing but can never lift one house out of the day and put it back
somewhere better — which is the move he is describing. `orOptImprove` makes it: one to
three consecutive stops, tried at every other position, both ways round, alternating
with 2-opt until neither finds anything more.

⚠ **The first measurement of this said it was worthless.** 19 miles a season, on a
simulated book that dropped every house into a tidy pocket 0.8 miles across — where
almost any order is a good order. Scattering the customers across their towns, which is
the book the office actually has, made the same change worth **113 miles a season off
10,167, about 1.1%, with no day made longer**. A fixture that is too easy does not
report a small benefit; it reports a false one.

**And "far" was being measured from the wrong place.** `outlyingStops` asks how far
each house is from the *day’s centre*, and the branch below it then holds the far ones
back to the end, on Addie’s rule — *"we dont want a long drive in the middle of the day
we would rather that be at the end of the day on their way back home."* On a day whose
weight is out north, two houses south-west of the yard are "far from the centre". So
the crew drove past them at eight in the morning, worked the north all day, and came
five miles back for them. ⛔ **The half nobody was asking was whether last was on the
way home.**

Both shapes are built now and the shorter one is driven:

| the day | what happens |
|---|---|
| the far group really is on the way home | it goes last, exactly as it always did |
| the far group is a knot beside the yard | it goes first, on the way out |
| the two are within `FAR_FIRST_MARGIN_MILES` | her rule keeps the tie |

⚠ **The margin is 0.5 miles and it is not decoration.** A round trip driven backwards
is nearly the same round trip, so a bare `<` would flip a standing instruction on
rounding and the far house would land first for no reason anybody could see. Measured
over 8 simulated seasons, 0.5 keeps 13.8 of the 15.8 available miles while overturning
her on **9 days of 337 instead of 25**.

⛔ **Not splitting at all was tried and refused.** A third shape — one plain tour, no
outlier held back — is worth another 85 miles a season, and it **tripled** the number
of days with a long leg buried mid-day, 8 to 24. That is the thing her rule exists to
prevent, so it is not ours to take on mileage alone; it is written down as a question
for her.

⚠ **And mileage is not the argument for the second fix.** Once or-opt is in, choosing
the shape is worth about 1.7 miles a season. It is in because driving past a house in
the morning and coming back for it in the afternoon is *visibly* wrong, and the office
is looking at it.

*Where it is proved*: run-all.js **Suite 322**. 10 sabotages red-checked — and the
first pass caught only 7: crippling or-opt to move a single stop, to refuse to turn a
moved run round, or to run once instead of alternating all left the suite green, so
three more days were searched for and added.
*Rulings*: [[SCH-71]] in `claude/questions-map.md`.

### Who goes to the house that is miles from anywhere

Added 2026-09-10. Dax: *"if someone is way out of the way as an outlier they should fall
into a one man day so a full crew isnt being paid to go that far out."*

An outlier — a house with fewer than eight others within ten miles — now gets an **area
of its own**, which makes it a crew-day of one house. ⛔ **This reverses the call made
the day before**, which left outliers in their town precisely *because* an area of one
becomes a one-man day (measured: one-man days 1 → 3). That argument was sound about the
wrong cost. Minimising one-man days was never a reason to send **four people** forty
miles to hang one house — and his own earlier ruling says so: *"high milage is better for
a one man than a one crew or two crew."* A crew-day is four wages; every mileage figure
in this document prices fuel and none of them price people.

⭐ **The first half alone would have made it worse**, and this is the part worth knowing.
A crew-day of one house still *shares its date* with a full run — so the date holds 21
houses, `isOneManDay` (a property of the **date**) is false, and the office rosters two
full crews. One of them drives sixty miles for one house, which is exactly what he asked
to stop. So being one person became a property of a **crew's run**: `crewIsOneMan`.

It shows up in the two places the rostering is actually read — the route heading on the
day panel badges the run **1 MAN**, and the One Man Installs tab now lists thin runs
beside the whole days, under *"On a day somebody else is also working"*.

⚠ **It completes the day rule rather than replacing it.** A date that is wholly one
person is still one-man for everything it always was, and is deliberately not listed
twice. ⚠ **And it predates the grid** — a thin crew-day beside a full one is what the
town container did with Levan too.

*Where it is proved*: run-all.js **Suites 318 and 321**. 7 sabotages red-checked; two
were misses on the first pass — a fixture with only ONE outlier cannot tell "its own
area" from "one shared outlier area", and nothing asserted that the tab actually renders
the runs it asks for.
*Rulings*: [[SCH-69]] in `claude/questions-map.md`.

### Nobody is on a day with nobody holding their sheet

Added 2026-09-10. Dax, reading ten stops under *"Not on either crew's route"* after a
rebuild: *"it is off limits to have anyone scheduled in a day not on either crews
routes, save that as a rule and dont design the system so its even possible."*

**What put them there.** The crew split counts TOWN NAMES and gives each crew at most
two of them, so two crews can cover four towns and no more. That was a sound cap while a
crew-day *was* a town — and the grid made a crew-day a block of adjacent houses, which
on the Wasatch Front routinely spans eight or ten town lines within a few streets. His
1 October held thirty-three houses across ten towns: four towns got sheets and the other
ten stops fell out of the bottom.

⭐ **`dayCrewHouses` is total now.** Whatever the towns managed, every house on a day
belongs to exactly one crew when it returns — a house no town covers goes to the crew
already driving nearest to it. There is no path out of that function that drops
anybody, which is the difference between *rescuing* a stranded house and making
stranding unrepresentable.

⚠ **And exactly one crew, which is the same fault pointing the other way** — a house on
two sheets is two trucks in one driveway. That could not arise through `dayCrewTowns`,
which marks a town taken as it hands it out; closing it here means the guarantee belongs
to the function whatever it is handed. It was found by a property check over 400
unplanned days, not by anybody thinking of it.

⛔ **The town question survived under its own name.** `housesOutsideCrewTowns` answers
*"is this house outside the towns its day's crews work"*, which is a different question
and still has a real answer: it is how `rehomeMovedHouses` knows a customer who moved
from Lehi to Provo is sitting on a Lehi day. Collapsing the two into one always-empty
list would have stopped it moving anybody again, silently, with every screen looking
right. `unassignedHousesFor` is kept as the tripwire that should now always be empty.

*Where it is proved*: run-all.js **Suite 320** asserts the PROPERTY over 400 days nobody
designed — random towns, sizes, crew counts, pinned and unpinned crews, coordinates and
none — because fixing examples is exactly what let this fault come back. 7 sabotages
red-checked; two were misses on the first pass, one of them the wiring that keeps
re-homing alive.
*Rulings*: [[SCH-67]] in `claude/questions-map.md`.

### What a crew-day is made of: a patch of map, not a town

Added 2026-09-09, closing Q-023, which had been open since 27 August. Addie, asked
whether it matters that a crew's houses are all in one town: *"what matters is that all
the houses are next to each other. So if there not all in Lehi that is okay just as long
as the houses are next to each other."* Dax: *"the way its set up is like a grid across
everywhere we do so each box on average has 20 houses and so then the crews can go
across."*

A town boundary is a line on a county plat, not a fact about driving. Lehi is 23 miles
wide, so "one town" never meant "near each other" — while eleven houses in Lehi and nine
in American Fork within a few streets were **refused**, because American Fork had to be
on a list somebody typed.

`js/grid.js` — 718 lines that sat on main, tested and imported by nothing, since 27
August — is now wired. `seasonAreasFor` runs it once per rebuild and stamps a **block**
on every house that has a map pin; `planNewCrewDays` buckets on that instead of on the
town name.

⚠ **The container is all that moved.** The builder still sorts each bucket by priority,
still fills a day from one bucket and tops up from at most one neighbouring bucket,
still keeps two crews out of one bucket. Every rule from 24–26 August stands; they were
written in town words because a town was the only container there was.

⭐ **The sheet says the towns it covers** — Dax chose that over a block number and over
the nearest cross-streets. A day spanning two towns prints both; the many blocks inside
one town read exactly as before. The town is also still what the **forecast** is asked
about: Open-Meteo has never heard of block 41, and handing it one turns the cold rule
silently off.

**Measured on an 810-house book before it shipped:**

| | town container | grid container |
|---|---|---|
| working days | 21 | 22 |
| crew-days | 42 | 44 |
| one-man days | 1 | 3 |
| median crew-day width | 2.79 mi | 2.63 mi |
| **worst crew-day width** | **28.7 mi** | **10.0 mi** |

Blocks come out a median of 20 houses (mean 17.2, none over 20, smallest 10), and **23
of 47 span more than one town** — every one of those was impossible before. The cost is
one more working day and two more one-man days, both top-up remnants; the tail packer
runs after the builder in a real rebuild and is not in those figures.

⚠ **And that table left the commute out entirely**, which Dax spotted: *"more days
generally is more gas because you need to include drive time from the house."* Counted
properly ([[SCH-66]]):

| | out and back | between stops | total | fuel |
|---|---|---|---|---|
| town container | 735 mi | 300 mi | **1035 mi** | $242 |
| grid container | 883 mi | 196 mi | **1079 mi** | $252 |

So the grid costs **44 miles a season, about $10** — and buys about **two hours of
driving back**, because those miles move off residential streets and onto the freeway.
The break-even is a between-stops average of 31.6 mph; a crew stopping at every driveway
is well under it. ⛔ **And doing FEWER houses in a day does not save miles either** ([[SCH-68]]). Asked
whether the builder should leave a day short when that comes out cheaper overall, it was
measured: never topping a short day up costs **1108 miles and 24 working days** against
**1067 and 22.3** as it ships. Every crew-day costs a drive out and back whatever it
holds, so fewer, fuller days is the cheaper shape. The borrow radius was swept from 0 to
20 miles across eight books: everything between 2 and 12 lands within **0.5%**, and one
book alone made 5 miles look like a 1.4% winner. Nothing changed.

⛔ **A "send them to the nearest area" tiebreak was tried and measured
at two miles** — every area is worked once a season, so the total drive-out-and-back is
fixed by how many crew-days there are, not by their order. `betterTown` carries that
note so it is not re-attempted.


⭐ **And this is what acts on the two-mile rule.** Dax, 2026-09-09: *"everyone in a route
should never be more than a like two miles between houses."* Which two houses that meant
was a real decision, so it has a row of its own ([[SCH-65]]) — **between consecutive
stops, not across the whole route**. Measured on the 956 pinned houses of the live
season, the two readings are nothing alike:

| reading | median | over two miles |
|---|---|---|
| drive from one stop to the next | 0.27 mi | 30 of 901 hops |
| width of a whole route | 2.92 mi | 43 of 52 routes |

The width reading was rejected on the numbers, not for convenience: holding a whole route
inside two miles forces days well under twenty houses, which fights *"prioritize doing the
most houses in a day as possible"* head-on. Lehi alone is **23.4 miles wide**, which is
also the plainest argument that "one town" never meant "near each other".

⚠ **Nothing enforces it as a hard limit**, and that is worth saying rather than implying.
What acts on it is the grid: a block is cut wherever consecutive houses are further apart
than `MAX_CURVE_JUMP_MILES` (3, stretching where the book thins out), and a house genuinely
on its own is lifted out as an outlier rather than packed into somebody's morning.

⛔ **An outlier keeps its town** rather than being dropped or given a block of its own.
grid.js argues for dropping it, and so did Addie in August — *"if they are a real
outlier they arent in the grid at all... its for my dad to do"* — but that predates One
Man Installs, which is this app's own answer and the one she has used since. A block of
one IS a one-man day: measured, it took them from 1 to 3.

⚠ **Two towns sharing a block are neighbours, whatever the typed list says.** Without
that the second town is legal for no crew and its houses are stranded on a day nobody
drives to — the fault SCH-50 was written to close, arriving through a new door. Sharing
a *day* is not enough; sharing a *block* is a statement about distance.

⚠ **And a house with no map pin keeps its town**, so it behaves exactly as it did. That
fallback is also what keeps every fixture written before this honest.

*Takes effect on* **Recalculate everything**.
*Where it is proved*: run-all.js **Suite 318** loads the real `js/grid.js` and runs the
real builder. 10 sabotages red-checked — four were misses on the first pass, including
the most important one of all: the fixture used two towns a few streets apart, which the
town container reaches anyway through its top-up, so it could not tell the two
containers apart. Three towns in one neighbourhood can, because a crew is its own town
plus at most one other.
*Rulings*: [[SCH-63]] in `claude/questions-map.md`.

### The order a crew drives a day, and where the leftover lands

Added 2026-09-09. Dax: *"we want it so they start in the back corner and they work there
way in on this grid so that if the last house doesnt get done its not way out of the way
then you can just adjust the next days box (or the next time you are in that area) so then
it can just start on the house that didnt get done then it moves into its box."*

A day is planned more often than it is finished, so the question this answers is not how
long the route is — it is **which end the unfinished tail falls off**. Each crew-day is now
ordered to FINISH pointing at the area the crews work next (`seasonAimPoints` walks the
season backwards and hands every day the centre of everything after it). The house nobody
reached is then the one nearest tomorrow, which is what makes *"just start on the house
that didnt get done"* a sensible thing to do rather than a detour.

⭐ **The back corner is the effect, not the instruction.** To finish near tomorrow the
route has to begin at the far side, so the day sweeps inward on its own — 28 of 29 days in
the measurement below. Forcing the first stop instead was built and thrown away:

| ordering | season miles | leftover → next area |
|---|---|---|
| yard to yard, as it shipped | 1263 | 2.58 mi |
| back corner forced, ending at the yard | 1332 | 2.80 mi |
| back corner forced, ending at the next area | 1324 | 1.29 mi |
| **yard, ending at the next area** | **1285** | **1.29 mi** |

Forcing the start costs three times as much, and ending at the yard left the leftover
FURTHER from tomorrow than changing nothing at all. **The price of what shipped is 21 miles
a season**, about two thirds of a mile a day, and that figure already includes the drive
home from wherever the day ends.

⭐ **A house the crew never reached is the first stop of the day that picks it up.** That is
the route half of being missed; the rank at 15 ([[SCH-61]]) is the order half, and it only
decides that they are on the day at all.

⚠ **The far-house rule is untouched and still wins where it applies.** Addie, 2026-08-21: a
house *"a little furthur out than everyone else"* falls at the END of the route, *"on their
way back home"*, because a long leg in the middle of the day costs an hour with twelve
houses still to do. That fires only when a day holds a real outlier; this owns the ordinary
day, which has none. A red-check sabotage that stubs the outlier test out is caught.

⚠ **And aiming is optional everywhere.** A caller that names no aim — the last day of the
season, a fixer route, a lifted sandbox — gets exactly the yard-to-yard round trip it
always had.

*Takes effect on* **Recalculate everything**, like the rest of the season.
*Where it is proved*: run-all.js **Suite 317** runs the orderer and reads the stops back —
every claim here is about the order of a list, which no source check can see. 9 sabotages
red-checked, and three of them were misses on the first pass: two because the wiring was
never asserted apart from the mechanism, and one because the fixture put the outlier on the
same side as the aim, so it passed whether the rule fired or not.
*Rulings*: [[SCH-62]] in `claude/questions-map.md`.

### Nobody is scheduled for a day no crew is driving to

Added 2026-09-09. Dax: *"we never want to see people not on either crews route but
scheduled for a day, thats just the same as a one man at the end of the day we calculate
for milage so put them on a day that they can be in the route."*

The day panel has a bucket headed **"Not on either crew's route"**, and it was there by
design: a town neither crew may legally work was left unassigned and shown, rather than
quietly loaded onto a crew that cannot drive it. Visible was right. Leaving them there was
not — a stop nobody is holding a sheet for is a special trip, which is the one thing the
whole season is arranged to avoid.

**Most of them never had to be stranded.** `dayCrewTowns` shared towns out biggest-first
to whichever crew was carrying least, which hands the second town to the **empty** crew —
so on 1 October, Lehi (14) and American Fork (4), which are neighbours and would happily
have ridden together on one sheet, went one each and spent both crews' dominant-city
slots. Orem and Vineyard were then legal for nobody, and two customers sat in the bucket.
`bestCrewTowns` looks for a better arrangement — but **only when the greedy has actually
dropped somebody**, so every day that was already whole comes out exactly as before. It
maximises **houses on a sheet**, never towns covered, and it may not buy a placement by
breaking the two-town cap or the neighbour rule.

⚠ **The stranding was self-reinforcing, which is why it stuck.** `dayCrewCount` measures
`dayAssignedHouses` — the houses a crew actually holds — so the two stranded houses were
not counted, the day read as 18 over two neighbouring towns, and a day that size is a
**one-crew day**, which collapses both crews' towns onto one sheet. Being stranded is what
removed the second crew that could have taken them.

⚠ **The honest empty bucket survives** for a day that genuinely cannot be covered. That is
what tells the office — and `rebuildSeasonDays` — to move those houses to a day that can
hold them, rather than the split pretending they fit.

**And a one-man day carries everybody on it.** Some thin days hold four scattered towns
that cannot pair into two legal crew-towns however they are arranged — 9 October is five
houses across Provo, Cedar Hills, Cottonwood Hts and Salem. Those are one person's work,
and the town rule is about where you may send a **crew**, so on a one-man day the cap
stops applying and every house on the day goes on the single sheet (Dax, 2026-09-09).

⚠ **This supersedes one clause of the 2026-08-20 ruling** — *"a light day spread over
three towns still needs two crews however few houses are on it"* — and only that clause.
It is still exactly right about a crew, so a one-**crew** day (nine to nineteen houses) is
untouched and a town it may not drive still shows in the bucket above.

⚠ **It also closed a disagreement between two screens that was already live.** `isOneManDay`
counts the whole day, so One Man Installs listed these as one person's work, while
`dayCrewCount` counted **towns** and badged the same day two crews — 11 December, two
houses in Highland and West Jordan, was asking for two crews. Both answers were on screen
at once and neither was reading the other. Ruling **SCH-53**.

**Measured across the ten install days in the live plan: 7 houses on no sheet before, 0
after**, and 11 December drops from two crews to one.

Rulings **SCH-50**, **SCH-51** and **SCH-53**. *Proved by run-all.js **Suite 314**, which runs the real
crew split against the 1 October day rather than reading it — every claim here is about
which crew a house ends up on. Red-checked with eight sabotages, seven caught; the eighth
flattens a tiebreak that only ever chooses between arrangements placing the same houses,
and is reported rather than papered over.*

### The forecast, beside the map

Added 2026-09-09. Dax: *"also everday it should show the forecasted temperature for the
area by the map."* The builder has read the forecast since 2026-09-03 and nothing ever
showed it, so a day pushed for being freezing looked exactly like a day pushed for any
other reason. `dayForecastChips` puts one chip per town in the caption above the day's
maps, marking a town at or below the cutoff — which is **read** from `COLD_DAY_MAX_F`, not
typed again.

⚠ **No forecast means no chip** — never a dash, a zero or an "unknown". Open-Meteo answers
about sixteen days and the season runs into December, so most dates have no number, and a
placeholder on every one of them is a strip of noise that teaches the office to stop
reading it on the days it does say something. `ensureForecastForPanel` fetches once, from a
flag rather than on each draw, because this panel redraws on every tick of every box on the
page. Ruling **SCH-52**.

### A day the office has short-handed on purpose

Addie, 2026-09-03: *"there are some days we will need to have 1 crew or 1 man if a
crew doesnt show or if a crew takes time off ect, make an option in the day where you
can force there to be one crew in a day but by default it doesnt care and it keeps the
math the same with get as many houses in a day as possible."*

Schedule → pick a day → **Crews on this date**: *Normal — as many houses as fit* /
*One crew only — up to 20 houses* / *One man only — up to 8 houses*. This is an
**exception list, not a new rule**: every date is Normal until somebody changes it, and
a season with nothing marked is laid out by exactly the maths described above — two
crews, twenty each, the day filled up.

**It is keyed by DATE, and saved with the plan** (`dayLimits` on the `routeSchedule`
document, `'2026-11-10' -> 'crew' | 'man'`). That is what makes **Recalculate
everything** honour it. Anything stored on a *day* would not: the rebuild replaces every
day object it makes, which is why `soloCrew` — the office's choice of *which* crew works
a one-crew day — does not survive one. It also matches what the office is actually
saying: the crew is away on the 10th, whichever houses end up on the 10th.

**How it reaches the builder.** `rebuildSeasonDays` passes `dayShapeOn` in as
`planNewCrewDays`'s `dayShape`. That function answers `null` for every unmarked date —
and `null` means "the ordinary maths", so every untouched code path is the one that was
there before — and `{crews: 1, cap}` for the handful that are marked. The builder is
never told what "one man" *means*: the cap comes in as a number, so `ONE_MAN_MAX_HOUSES`
stays the single definition the One Man Installs tab already reads. Houses that no
longer fit roll on to the days after it, exactly as an overflowing day always did; the
season simply runs a little longer.

**The tail sweep had to learn about it twice over.** `packTailCrewDays` relocates whole
crew-days onto earlier dates "that have a crew spare" and tops crew-days up to the cap,
and both questions have a different answer on a marked date. It is handed the same
`dayShape`, and it also **refuses to dissolve a marked date's own crew-day**: a day of
eight on a one-man date is not dribble the builder left behind, it is the size somebody
asked for, and sweeping it away leaves that man with nothing to do and the office looking
at a blank day where they had just put the mark. Every *other* short crew-day is still
swept up as before.

**What reads the mark, rather than guessing.** `dayCrewCount` returns 1 for a marked
date whatever the houses say; `isOneManDay` lists a one-man date whatever it is holding;
`maxTownsPerDay(day)` now takes the day, so a date short-handed to one crew is held to
one crew's two towns rather than being allowed four. The day list badges it
`1 CREW · SET` / `1 MAN · SET`, so a day somebody shaped by hand reads differently from
a day that is merely small — the first will not grow back on the next rebuild, the second
will.

⚠ **It shapes the next rebuild; it does not move houses on the spot**, and it can never
touch a day inside the 48-hour lock. The control says both out loud, because a mark that
appeared to do nothing would read as a broken button. For a crew that has already failed
to turn up this morning the tool is *not done — reschedule*, which is about houses rather
than about the calendar.

*Proved in* run-all.js **Suite 294**, whose first check is the one that matters: an
unmarked season is byte-for-byte the season the builder made before.

### Why the schedule looks empty in September, and the write storm behind it

Addie, 2026-09-03: a whole season showing **one day and three houses**, and then
`@firebase/firestore: FirebaseError: [code=resource-exhausted]: Write stream exhausted
maximum allowed queued writes` the moment she pressed **Recalculate everything**.

One cause, both symptoms. **Counted on the live book rather than reasoned about:**

| | |
|---|---|
| customers | 956 |
| blank `rsvpStatus` | 950 |
| said yes | 5 |
| **yes AND `rsvpRespondedAt` stamped** | **3** |
| out of the season | 952 |
| still carrying a booking stamp from last season | 955 |

`isOutForSeason` ends in the `SEASON_ELIGIBILITY = 'confirmed-only'` branch: somebody
is in the season only if they said **yes and the reply is stamped**, or they are a new
hang nobody was ever asked (`audienceNeverAsked`). Three people qualify, so the builder
places three. **The schedule was right.** This is her own ruling working — *"play with it
until the only customers in the schedule are the confirmed ones"* — and it is the normal
state every September, before the RSVPs come back. Worth writing down precisely because
the screen looks catastrophic when it is behaving.

**The same 952 caused the write storm.** `clearStaleInstallBookings` takes the booking
stamp off everybody who is out, and 951 of them still carried one. It wrote them one at a
time. The SDK queues 500 and refuses, so the run died partway — and the next press tried
the same nine hundred again.

Three faults, all three fixed:

- **The customer records are batched.** `writeBatch` in chunks of 400 — 951 records
  become 3 commits. This file had no batched write anywhere before; `writeBatch` was not
  even on the import list.
- **The routes are swept once for everybody.** `removeCustomersFromUpcomingRoutes`
  (plural) walks the upcoming routes a single time and writes each affected route once,
  whatever it is carrying. The old per-customer call walked every route 952 times and
  rewrote a shared route once per stop removed. The singular version stays — the office
  edit path and `portalSave` each remove exactly one person.
- **One run at a time.** The button fires this without awaiting on purpose, so nothing
  stopped an impatient second press doubling the writes. `clearStaleBookingsInFlight`
  makes the second press join the run already going.

⚠ **The cache is only updated after a chunk commits.** Assigning first makes a failed
chunk look cleared: the row stops contradicting itself on screen while the record in
Firestore still says booked — the exact contradiction this sweep exists to remove.

⚠ **Two wrong theories were measured and discarded before this one.** That the arrears
hold was emptying the season (only 19 customers owe from last season), and that the
season-start date bug was to blame (real, but unrelated — see the section above). Both
were plausible; neither survived counting.

*Proved in* run-all.js **Suite 296**. **Suite 286** still owns the other half — *which*
records get cleared, and the three kinds that must not be touched.

### Confirming an answer that is already on file

Addie, 2026-09-03: *"the badges on the page that says confirmed, maybe next year or
pending, that doesnt update it used to its because we got rid of the thing that was
confirmed and maybe next year badges in add customer and put all that under RSVP Status
but its not working"*.

**The badge was never the broken part.** `seasonBadgeKey` delegates to
`isOutForSeason`, which under `SEASON_ELIGIBILITY = 'confirmed-only'` wants a yes
**and a date on it**. What was broken is the only screen that can supply that date: the
RSVP Status dropdown stamped `rsvpRespondedAt` **only when the dropdown value moved**.

So the one state the office actually has to repair by hand was the one state it could
not repair. A record carrying `rsvpStatus` 'yes' with nothing dating it — the assumed
yes written when a quote is converted, or carried in by an import — already shows **Yes**
in the dropdown. Picking Yes changes nothing, so nothing is stamped, so the badge stays
**Pending** for ever. `seasonHold` even prints the instruction: *"a yes is on file but
nothing dated it — confirm it on their record"*. Following it did nothing.

Measured on the live book the day it was reported: **5 customers said yes, 3 were dated.**
Two people were stuck with no way out from any screen.

The save now stamps in two cases rather than one:

- the answer **changed** — unchanged behaviour, and still nulls the date when the answer
  is cleared back to Unanswered;
- the answer is **the same but nothing dated it** — the office confirming what is already
  there, which is exactly what the hold message asks them to do.

⚠ **It never re-stamps an answer that already has a date.** That date is what the Yes
sheet and the customer history both read; moving it every time somebody edits a phone
number would rewrite history.

⚠ **The fix is in the SAVE, not in the badge.** Softening `isOutForSeason` to accept an
undated yes would hand a Confirmed badge to people every scheduler in the app still
refuses — the precise disagreement the badge's own note says it exists to prevent.

*Proved in* run-all.js **Suite 297**, red-checked by deleting the new branch. **Suite 78**
still owns the value-changed path.

### Nothing is hung before the season starts

Addie, 2026-09-03, reading two lines of her own season bar:

    Season start   10/01/2026
    Plan runs Tue Sep 22 → Sep 22.

*"this is very wrong because the season start date is oct 1"*.

Both lines come off the same plan and they were computed differently. The box is
`BASE_START + globalDelta`. A day is laid out at `BASE_START + base + globalDelta +
cascade` — and nothing clamped it, so **any day carrying a negative `base` or
`cascade` rendered before the season had started**, with no way from the outside to
tell which half of the bar to believe.

`layoutSequence` now takes a **floor** and `computeDates` passes it
`seasonStartDate()` for install days. Three things about where that floor sits:

- **It is in the layout, not in the button that caused it.** A plan already saved in
  that state heals on the next draw; nobody has to go and repair the data.
- **It only ever pushes forward.** A day legitimately later than the start is left
  exactly where it was — a clamp working in both directions would flatten October onto
  the 1st.
- **A pinned day never sees it.** *Force exact date* is the office overriding the
  layout deliberately, the same reason it is allowed to place a day on a weekend, and
  the pin branch returns before the floor is consulted.

⚠ **Takedowns are not floored.** They run off `TAKE_BASE_START` — a different season
with a different first day — and lending them the install floor would haul every one of
them into October.

**Two ways a day acquires a negative offset, and the floor catches both.**
*◀ Pull this + rest earlier* (`cascade(id, -1)`) decrements until the date moves and
had no floor of its own, so each press walked the plan further into September; with the
floor in place the date stops moving, the existing revert puts the cascade back, and the
toast now names the wall it hit rather than saying "no gap before this day". Separately,
`rebuildSeasonDays` keeps the days it does not re-lay, and those go on carrying a
`base` measured against whatever `BASE_START` was before the rebuild moved it.

This is the rule `seasonFirstDate` already states for the **builder** — *"with no
floor, building the season in August books Christmas installs for August"* — finally
applied to a plan that already exists.

*Proved in* run-all.js **Suite 295**, red-checked by deleting the floor line: the two
checks that reproduce her exact season bar go red and nothing else does.

### The free quote asks less, and a property list that outlives it

Addie, 2026-09-03, across three messages: *"a lot of info in the free quote shouldnt be
there including upload picture and side of house… side of house should be in detail form,
1 side should be default"*; *"there should keep the option to add another property but
make sure there is a way to delete the extra property in case they accidentally push on
it"*; *"in edit customer we need to have add a building set up there as well in case they
come around later and want another building."*

**Off the free quote form**

- **The photo uploader, entirely.** A downscaler, a signed Cloudinary upload, and a
  four-named-walls grid per building. The form promises a quote *"in about two minutes"*,
  and photographing four walls of a house — and of every outbuilding — was the most
  expensive thing on it, asked of somebody who had not yet been given a price. Removed
  rather than hidden: a hidden row is how a feature comes back by accident.
- **The side count** — moved, not dropped. It drives the footage and so the price, so it
  is now asked on the **Install Details** form, after they have approved.

**Then the property list went too, one day later.** Dax, 2026-09-04: *"get rid of the add
a building on the property button on free quote but keep it in all customers."* So the
free quote no longer asks about outbuildings at all — not the photos of them, and now not
even their names.

- **The row goes with the button, not just the button.** Without a way to add one,
  *"Other buildings on the property (optional)"* is a heading over a single un-removable
  **Main house** box — a section that can no longer do the one thing it exists for.
- **The code went with the row.** `renderQuoteBuilding`, `addQuoteBuilding`,
  `removeQuoteBuilding` and the `quoteBuildings` array are all gone from index.html. A
  repeater whose only entry point was deleted sits in the file unreachable, and the next
  person to read it wires it back — the same rule that removed the uploader rather than
  hiding it.
- ⚠ **The field is still written.** A quote still saves `buildings` as a one-entry array
  holding the main house. admin's quote card, `buildQuoteEmailHtml` and
  Convert-to-Customer all **walk** that array, so a quote saved without the key would make
  three readers reach into `undefined` on a quote that is otherwise fine.
  `addCustBuildingsFromQuote` already drops the main house by name on the way across, so a
  converted customer simply carries nothing extra now instead of arriving malformed.
- **"But keep it in all customers"** is the half below — Edit Customer is untouched, and
  is now the only place anybody is asked about a shop or a guest house.

*The 2026-09-03 reasoning is kept because it was right for the day it was written:* the
repeater stayed then, with **Remove** on every extra row and none on the main house,
because a quote with no house is not a quote; removing took the row out of
`quoteBuildings` as well as out of the page, since the element alone would leave the
object in the array and submit a building the customer could no longer see, read as a
blank one. All of that is moot now that nothing can add a second row — but it is why the
array, not just the markup, had to be deleted rather than left behind.

**One side is pre-picked on the details form, and deliberately nowhere else.**
run-all.js asserts the *opposite* for Edit and Add Customer, and it is right to: those sit
over ~956 records nobody has ever asked, so a default there stamps a made-up answer on all
of them — *"a count nobody gave is not a count"*. One customer looking at the question for
their own house is a different case. A **fresh quote stores no count at all** — absent,
not 1 — because every reader turns absent into 1 through `portalSideCount`, so the
default holds without claiming anybody answered.

⚠ **The server had to be told.** `quoteSaveDetails` keeps a whitelist and the
emailed-link path — the common one — goes through it, so a field the browser sends and the
function drops is lost with nothing going wrong on screen. It is clamped there too, never
trusted from the browser: a side count of zero would price a house with no roofline.

### Other buildings on a customer, and the loss that uncovered

`buildings` has been collected by the public quote form for months and **the word did not
appear anywhere in admin.html**. So a customer who told us about their shop at quote time
had it recorded on the quote and then dropped the moment they became a customer — silently,
with nothing to look at.

Edit Customer now has **Other buildings on the property**: name, Add, Remove.
`addCustBuildingsFromQuote` carries across whatever the quote collected instead of
throwing it away, filtering out the main house — on a quote that is one of the buildings,
because the quote has no record of its own; on a customer the record IS the main house.

⚠ **The Add button is wired inside `openEditCustomerModal`, which runs on every open**,
so `dataset.wired` on the element is the whole mechanism. Unguarded, one press would
append a row for every customer looked at this session — the Inbox folder sidebar shipped
exactly that and it cost 2815 Firestore writes from one drop.

⚠ **The field is labelled in `CUSTOMER_FIELD_LABELS`, and that is what gives it a
reader.** CLAUDE.md §1 wants every field written, read *and* declared, and the change-log
gate refused it until it had words. It uses its own `buildings` kind rather than
`list`: these are objects, and `join()` would print `[object Object]` into somebody's
history — worse than no entry, because it still looks like one. An emptied list reads
*(none)* and a never-set one *(blank)*, which are different facts and the first is the one
worth reading.

⚠ **Nothing else reads them yet** — they do not print on a crew sheet. Said here rather
than left to be discovered.

*Proved in* run-all.js **Suite 302**; **S62** and **S80** were repointed rather than
weakened, and **S86**'s sandbox lifted the real reader.

### "No" is gone from the office dropdown, but not from the system

Addie, 2026-09-03: *"we can just get rid of the no under rsvp because it means the same
thing as back next year."*

**They did not mean the same thing, and the difference was destructive.** Picking **No**
in Edit Customer set `needsLightRecycle` — the warehouse queued to pull that customer's
bundle apart and hand their number back to the pool — while Back Next Year deliberately
never does (RS-05, and the "hole G" note: Back Next Year neither creates a recycle nor
destroys one). So one entry in a list of answers also started physical, irreversible work.

Removing it is therefore the right change rather than merely the requested one: **a
recycle should be a button that says so, and it already is.** *Recycle Their Old Set* in
Edit Customer writes the same flag under a label describing what it does. Nothing can no
longer be done.

**What actually changed**

- The `#editCustRsvp` dropdown offers **Pending / Unanswered / Yes / Back Next Year**.
- The branch that set `needsLightRecycle` when the answer became `no` is gone — with No
  unpickable it could never fire again, and dead code that still looks like the rule is
  worse than no code.
- The **undo** half stays: a record that already says `no` and is being brought back into
  the season still has its queued recycle cancelled.

⚠ **The VALUE `no` is not gone and must not be.** `portalRsvp` still writes it when a
customer taps No in an RSVP email, so `seasonBadgeKey`, `isOutForSeason`, the Members
filter, the exports and the Yes sheet all still have to understand it — and they do. The
Members-tab **filter** keeps its No option on purpose: those records exist and have to be
findable.

⭐ **A stored `no` is SHOWN, not translated** (changed 2026-09-04, RS-50). Until then the
form mapped it to Back Next Year and whoever opened and saved that record converted it —
*one state, one spelling*, which was free while the two meant the same thing. They no
longer do: they are two badges and two Email Tool audiences, so that normalisation had
become a silent move onto the wrong mail-out, triggered by nothing more than correcting a
phone number.

⚠ **The fault it was fixing is still real.** Setting a `<select>` to a value it has no
option for leaves it blank — which reads as *Pending (never asked)*, the one state this
dropdown exists to tell an answer apart from — and the next save writes that blank over
the customer's actual answer. So `openEditCustomerModal` adds a **disabled** `No — they
answered this themselves` option, and only for a record that already holds it.

⚠ **Shown is not offered, which is what keeps RS-49 intact.** The office still cannot
CHOOSE No — choosing it is what queued the warehouse to take a bundle apart. Moving the
customer OFF it still works, which is the half that has to. The option is removed again
when the form is repointed at a record that does not hold No, because the house-tab strip
reuses this same form without closing it.

⚠ **The Excel destination is unaffected**, which was the thing worth checking before
agreeing to this. `HLX_STATE_TABS` keys the **Recycle** sheet on `needsLightRecycle` and
never on the RSVP answer, and **Contact 2027** on `maybeNextYear || 'backnextyear'`. The
recycle button still sends somebody to the Recycle sheet; Back Next Year still goes to
Contact 2027.

*Proved in* run-all.js **Suite 301**.

### One route note a day, not one a sweep

Addie, 2026-08-30: *"system inbox always has a bunch of schedule messages and it's to many to
keep up with. How can we fix this"* — offered four options, she chose **one digest a day**.

⚠ **Nothing was broken, which is why nothing was red.** The sweep runs every fifteen minutes,
every notice it wrote was true, and the duplicate guard above already caught the identical
ones. A day on which the routes genuinely keep changing is up to ninety-six *different* true
notices — and true-and-unreadable is still unreadable. An inbox nobody can keep up with is
one where the note that matters is missed.

**How it works now.** `noticeRoutesReconciled` builds its lines exactly as before, then hands
them to **`routeDigestBank`** instead of posting. The bank is `settings/routeDigest`, a single
document holding `{day, lines, dropped, updatedAt}`; each sweep merges its lines in, skipping
any it already holds. On the first sweep of a **new** day, `routeDigestBank` calls
**`routeDigestFlush`** on the previous day's bank, which writes **one** System note covering
the whole of it, and then starts today's bank fresh.

⚠ **The cost, said plainly**: a date that moves this afternoon is in *tomorrow's* digest, not
this afternoon's inbox. What still happens on the spot is the **activity log** entry and the
**toast** — and both toasts were repointed to say *"open Routes"* rather than *"see System
notices"*, because sending somebody to a note that will not exist for hours reads as the
sweep having failed.

⚠ **It is a document, not a variable.** The dashboard is closed and reopened all day and runs
on more than one machine; a day's changes held in memory are a day's changes lost at the first
refresh.

⚠ **A refused note carries the day forward.** The bank is rewritten wholesale on every sweep,
so a flush that failed would otherwise *delete the very day it was reporting*. `routeDigestFlush`
returns whether it wrote; on false the lines are carried into today's bank, prefixed with the
day they came from, and the overflow count travels with them. A refused flush also still writes
a short note to the System folder — a toast is gone the moment the office looks away and the
routes have already been rewritten.

⚠ **A line saying part of the sweep did not take goes first.** `report.writeFailed` means a
route and a customer record now disagree about which day a house is on. Per sweep that was
free; over a whole day it is one line among a hundred, trimmed from the end. `routeDigestFlush`
lifts any line beginning `⚠` to the top — a *stable partition*, so everything else keeps the
order it happened in.

⚠ **And the closing line survives whatever else is trimmed.** *"Nobody has been told about any
date that moved"* is the reason the note exists at all, and it is appended **after** trimming
rather than being inside the trimmed body.

⚠ **AND A LINE THAT TURNED UP IN EVERY SWEEP IS A LOOP, NOT NEWS** (2026-08-31). Addie:
*"I don't even know why there are so many changes being made in schedule and it is
concerning."* The digest answered the volume and not the question — deduplicating into one
note makes a line that happened **once** look identical to one the sweep found **forty
times**, which is exactly the thing she is worried about. The bank counts how many sweeps
each line appeared in; three or more is labelled `[happened N times today]`, and the note
opens with what a repeat usually means: a customer whose town field holds a **street**
invents a town that does not exist and every house on it is evicted each pass, and a record
that disagrees with the route it sits on does the same. Both are named by Health Check and
fixable from a customer record in a minute.

### The digest still shares a folder with the notices that matter

Dax, 2026-09-01: *"these almost spam messages flood the system messages making it so we
cant see messages we actually need to do something with, make it so we dont see these
spam ones but we still see important messages that we need to see."*

⚠ **This is not the 2026-08-30 complaint again, and the digest above is not the fix for
it.** That one was about VOLUME and it worked — ninety-six notices a day became one. This
is about the folder that one note lands in. `renderSystemMessagesTab` drew every System
notice in one flat list, so the daily route digest sat in the same column as *A Background
Check Has Stopped*, *Customer Number Needs Fixing* and *A Route Sheet Is Out Of Date* — and
being the longest thing there, it is what the eye lands on.

**What decides.** `noticeIsRoutine(d)` — a System notice, topic *Routes Kept Up To Date*,
and **no `⚠` anywhere in its body**. The mark is not a new convention: `routeDigestFlush`
already partitions on exactly it (`urgent`), so a digest that could not write a record, or
that caught a line looping all day, carries one and is **not** routine. One signal, read the
same way by the thing that writes the note and the thing that files it.

**What it changes.** Routine digests fold behind a single *Routine route updates (N)* row in
the System tab, one click from being read, and are left out of **both** unread badges.
Everything else in the folder is untouched and draws exactly as before.

⭐ **AND THE REST OF THE TAB IS NOW IN SECTIONS** (2026-09-02, MSG-07). Addie: *"Can we
make folders in system messages. instead of just having it all in one spot"*, and
*"schedule also has it's own folder"*. Twenty notices were arriving in one undivided list,
so the one that needed her was read at the same speed as the one that did not. They are
grouped **Money → Schedule & Routes → Quotes → Warehouse & Lights → Everything else**,
most-urgent first, each with an unread count; a section holding nothing is not drawn.

⚠ **The grouping is derived from the topic at render time, never stored** — every notice
already in the book predates the sections, so storing one would leave the whole history in
none of them. ⚠ **An unmapped topic falls in *Everything else***, which is the fail-safe
direction: a notice that exists, counts towards the badge and is drawn in no section is
worse than one in the wrong section. ⚠ **The routine digest above stays folded below the
sections rather than filling the Schedule one** — merging them would undo the fix that
stopped it burying the notices that need her.

⭐ **CANCELLATIONS AND THE MEMBER PORTAL GET FOLDERS IN CUSTOMER MESSAGES** (2026-09-02,
MSG-07). *"we need a place for cancelation messages to go … Also can we have inbox for
member portal."* `messageFolderOf` sends a *Cancellation Request* to **Cancellations**, and
*Note Added* / *Existing Customer - Address Changed* to **Member Portal**.

⚠ **Derived, so it sorts the messages already written** — every cancellation in the book
was written `folder:'Inbox'`, and routing only new ones would have left her existing ones in
the pile. Nothing is migrated. ⚠ **The office's own filing always wins**: `filedByHand` is
stamped by the drag, the right-click, Move to… and a folder being deleted, so a message
moved by hand stays put — without it, a dragged message springs back and reads as the drag
not working. ⚠ **A rename is deliberately not a filing** for a message stored in the folder, so
renaming does not pin everything inside it for ever — but a message sitting there only
by *derivation* **is** pinned, because otherwise the topic map would go on naming a
folder that no longer exists and that message would be in no list at all. Deleting a
folder files its derived residents into Inbox for the same reason. ⚠ **And `folder:'System'` is untouched by all of it** — that
field decides which *tab* a message is on, not which folder, and a topic must never be able
to move a notice between them.

⚠ **The nav badge was counting messages its own list has never shown.**
`renderMessagesList` has always filtered System notices *out* of the customer list
(`folder !== 'System'`) while the badge beside it counted `allMessages` unread — System
notices included. That is why it read 91 over a list holding a fraction of that, and why a
real customer message arriving moved it by one and nobody could tell.

⚠ **Nothing is deleted and nothing is marked read.** These notes record days that moved
under customers who may already have been told a date — the closing line of every digest
says so. Folding is a view, not a write.

⚠ **Both piles are drawn by one `systemNoticeRow`, and the handlers are bound over the
whole list.** Two renderers for one card is how the folded half quietly stops matching the
half above it; handlers bound over the visible half only would give a routine notice a dead
*Send to Warehouse* button. Suite 287 asserts both, and RUNS the classifier rather than
matching its source — four sabotages red-checked.

⚠ **Twice is not a loop.** Two sweeps can honestly find the same thing. Three is where it
stops being a coincidence, and a threshold that fired at two would put a warning on
ordinary days — which is how a warning gets ignored.

⚠ **And only surviving lines keep a count.** Carrying one for a line no longer in the bank
grows the document across a long day, and Firestore has a size limit — that ceiling is what
the reconcile note hit in 2026-08-19, reported as "Missing or insufficient permissions".

*Gated by* `route-digest.test.js` (`npm run test:digest`), which runs both functions against a
fake Firestore that reads back what it wrote.

### When something goes wrong, somebody is told (2026-09-08)

Addie: *"give an error message to them if it fails. Is there a way to send inbox message
that there was an error with sending an email/ or an error in approving/back next year/no
there RSVP? And can we make another spot in inbox that is error so anytime a member runs
into an error or our website runs into errors it will let us know. With two seperate
sections in error for member error and admin error?"*

**What was already true, and was the whole of it.** When a customer taps Yes on an RSVP
email and the call fails, they see an apology and a phone number. That has always worked.
Nothing anywhere told the office. So that customer goes on reading, for the rest of the
season, exactly like somebody who ignored the email — and on a send of around 960 people
that is a silence nobody can audit.

**Where it goes now.** The Inbox sidebar has a folder called **Errors**, with two sections
under it:

| Section | What lands there | Written by |
|---|---|---|
| **Member Errors** | A customer hit a failure on the website — an RSVP Yes/No, Back Next Year, approving or declining a quote, or the page breaking under them while they were in their account | `index.html` |
| **Admin Errors** | Something went wrong in the dashboard — anything the red "problems found" badge catches, plus every bulk email send that failed, with the reason | `admin.html` |

**Each report says what was being done, not just that something broke.** A member row names
the action ("Answering Yes to the RSVP email"), says the answer did **not** save, and warns
that the customer may ring. An admin row names who was signed in and, for emails, how many
did not go out and what the mail service said — a count the status line showed and then
threw away the moment she clicked anything else.

⚠ **"Names who was signed in" was true of the BODY and not of the ROW, until 2026-09-11.**
Addie, shown two Admin Error rows: *"can you update this?"* Both carried the line **"No phone
or email on this message, and no record matches it"** — the contact line ([[MSG-14]]) doing a
customer lookup on a message the office's own browser had written. `reportAdminError` hardcodes
`name`, `phone` and `email` empty, so that branch was the only one an admin error could ever
reach; it was not a lookup that failed, it was a lookup with nothing to look for. And the
heading above it renders blank on these rows, because `msgErrorWhoLabel` returns nothing
without a portal link to match — so the one line that could have named somebody named nobody,
while the address sat in the row's own body two lines down. The row now reads **Signed in as
&lt;address&gt;**, or **"Nobody was signed in when this happened"**, which is the signature of a
timer still running after a sign-out. Member errors keep their contact line — a customer really
did hit one of those, and ringing them is the point. [[MSG-21]], `msgStaffSignedInAs`.

#### What the folder has already caught (2026-09-10)

The first real read of these rows found three faults and one data problem. Recorded here
because the folder earning its keep within two days is the argument for it.

- ⭐ **The preferences form crashed for anybody who never ticked the outlet radios.**
  Neither `changes_outlet_timer` nor `changes_specific_outlet` carries `checked` in the
  markup, and both were read as `document.querySelector('…:checked').value` — which is
  `null.value` when nothing is ticked, so the whole save died before a single field was
  read. Now falls back to what the record already holds, else `'No'`.
  - ⚠ **The fallback is `'No'` to match the change test below it**, which reads a missing
    timer as `'No'`. Anything else makes an untouched radio look CHANGED, and
    `outletTimer` is one of the three `WAREHOUSE_BUILD_FIELDS` — that would queue a
    bundle rebuild for a house nobody touched.
  - ⚠ **The crash was the small half.** It arrived on a page opened from an RSVP link
    (`&rsvp=yes`), so the customer's answer went down with it. Only people who have
    answered are scheduled, so that is a house no crew is sent to — while the apology
    tells them to ring us and to them it looks like they already replied.
  - Covered by SCENARIO 7 of `portal-repro.test.js`, which runs the real lines out of
    `index.html` against the real page's DOM. 4 sabotages red-checked.
- ⭐ **Edit Customer save was failing outright, twice, and the report named nothing
  fixable.** "null is not an object (evaluating `s.indexOf`)" on Safari and "Cannot read
  properties of null (reading 'indexOf')" on Chrome — one fault, two wordings.
  - ⚠ **NOT DIAGNOSED, AND DELIBERATELY NOT GUESSED AT.** All four `.indexOf` call sites
    reachable from that handler were checked and every one is correctly guarded
    (`Array.isArray` on both colour comparisons, `String(x||'')` in
    `rsvpTemplateHasReferral`, `custInvoiceKey` can only return a string). `s` is not a
    variable in `admin.html` at all — a single letter means minified third-party code, so
    the throw is inside the Firebase SDK and the likeliest cause is a document id
    reaching `doc()` as null. **Which** id is the part nothing recorded.
  - So the catch now reports the first two stack frames. The next occurrence names its
    own function instead of costing another read of a 1,400-line handler. Two frames, not
    the whole stack: `messages` is capped at 5,000 characters on create by
    `firestore.rules`, and a refused write is how this reporter goes silent.
- ⚠ **An "Unhandled promise: Missing or insufficient permissions" row is not necessarily
  an auth fault** — §5 records that the same wording is what Firestore returns when a
  `messages` write breaks the 5,000-character cap. Check the rule's CONTENT conditions
  before its auth ones.
- ⛔ **And six customers' RSVP answers were lost** — `internal` and `deadline-exceeded`
  out of `portalRsvp`, meaning the Cloud Function threw or timed out. Those are people who
  opened the email, pressed the button, and were not recorded. They read as non-repliers,
  so `isOutForSeason` drops them. **The rows are the only record that they answered at
  all**, which is the whole reason this folder exists.

#### The seven "lost" RSVPs were not lost (2026-09-11, [[RS-58]])

Addie, checking three of the members the Errors folder had reported: *"It looks like those
ones went through and are confirmed."*

⭐ **She is right, and the row was stating the opposite as fact.** `portalRsvp` writes the
answer to `jobAddresses` as its **first** action, and only then does the slow work — reading
the bill for a yes, walking the upcoming routes for a no. Both of those carry their own
try/catch and cannot throw. So an `internal` or a `deadline-exceeded` arriving in the browser
means **the response went missing, not the write.**

⛔ **It cost something in both directions.** The customer was apologised to and told to ring
us about an answer we already had. And the Member Errors row said *"did NOT save … we still
do not have it"* — which sends the office to chase, and possibly overwrite, a good record.

⭐ **So the call is retried**, up to three times on a 25-second timeout. That is safe because
`portalRsvp` is idempotent, and that was checked branch by branch rather than assumed:

- the updates are the same values written twice;
- `seasonYesUpdates` computes `wasOut` from the record **as it now is**, so `cameBackThisSeasonAt`
  and `needsDayAssignedAt` are not re-stamped on the second pass;
- `rejoinNeedsBuildServer` reads the already-updated status, so the Rejoined After Recycling
  note cannot be raised twice;
- `clawBackReferralServer` is guarded on the **transition**, so a referral cannot be taken
  back twice;
- `removeCustomerFromUpcomingRoutes` filters, so running it again removes nothing.

⚠ **Scoped to `portalRsvp` and nothing else.** `portalSave` can add a $30 colour-change fee,
and blanket-retrying `callPortalFn` is how somebody gets charged twice. Do not widen it.

⚠ **The short timeout is the point.** The default is 70 seconds, so one bad attempt spent the
customer's whole patience and left no room to try again. Three attempts now fit inside the
time one used to take.

⚠ **A stale link is still refused on the first try.** `not-found` is the one failure we *can*
be certain about, and retrying it only makes the customer wait three times as long for the
same sentence.

⚠ **And when all three fail we still do not know it was lost.** Both the customer and the
Inbox row now say the reply may already be saved. The old wording is **kept** for the cases it
is still true of — a refused write, a stale link, anything that failed before the write —
because a real loss reading as a maybe is how an answer nobody has is never chased. The caller
says which it is.

⭐ **And the route sweep stopped reading the whole season.** `removeCustomerFromUpcomingRoutes`
read **every** `scheduledRoutes` document ever written and threw most of them away on the next
line. It now asks for `date >= today`. That runs inside `portalRsvp` after the answer is written
but before the reply reaches the customer, so its cost is time they spend looking at "One
moment…" — and when it overran, they were told their answer had failed.

#### And the cold-start theory was wrong — measured, 2026-09-11

The line that stood here said the cause was probably cold starts: `functions/index.js` is a
329KB module with no `minInstances`, so a burst of RSVP opens right after a send would be a
burst of cold starts. **That was a hypothesis and it is now refuted.** Measured by timing the
require on a clean install, three runs:

| | |
|---|---|
| `firebase-functions/v2/https` | ~190 ms |
| `firebase-admin` | ~1 ms |
| **our own `functions/index.js`** | **~55 ms** |
| **total module load** | **~250 ms** |

A quarter of a second. Add container start and a cold `portalRsvp` is a second or two, not
seventy. ⚠ **So do not spend money on `minInstances` for this** — it would buy nothing here, and
that was the obvious next move.

⭐ **What the evidence actually supports.** For a **yes**, `portalRsvp` does exactly three small
Firestore operations: find the token, write the answer, read one invoice. Every `await` after the
write is inside its own try/catch — `clawBackReferralServer`, `removeCustomerFromUpcomingRoutes`
and `arrearsForCustomer` are each wrapped whole, and the rejoin note is wrapped at its call
site — so the function **cannot throw after the answer is recorded.** Addie confirmed the answers
were on the records. Put together: the server did its work and returned; the reply did not reach
the browser.

That is a **transport failure between the function and the customer's browser**, not a server
fault — which is what the client SDK reports as `deadline-exceeded` (its own 70-second timer) or
`internal` (a response that arrived broken or not at all). It also fits who it happened to: three
of the seven were on phones, where a locked screen or a switched app drops a connection mid-request.

⭐ **So the retry is not a workaround for an undiagnosed bug — it is the fix for this failure
mode.** A second attempt on a fresh connection is precisely what recovers a dropped response, and
because the call is idempotent the re-send confirms the answer that was already saved.

⚠ **The logs would still confirm it** and are worth a look if it recurs — invocations completing
in about a second with no errors logged is the signature of exactly this. But nothing is waiting
on them any more, and no code change is pending behind them.

⚠ **AND THE ORDER IS NOW HELD BY A CHECK**, because it is the whole reason a lost reply is
harmless. `run-all.js` keeps a census of every `await` that runs after the answer-write: a new one
fails the build until somebody has decided whether it may take the customer's confirmation down
with it, each named helper must still carry its own try/catch, and the write must still come
first. Same shape as build-stamp's clear census. Three sabotages red-checked; a fourth was a
no-op and is recorded as such rather than counted.

#### Opening an RSVP link is no longer answering it (2026-09-11, [[RS-57]])

Addie: *"lets do a confimring step."*

**What it used to do.** `handleRsvpLink` called `portalRsvp` before it drew anything, and the
comment said why in as many words — *"the RSVP is recorded on the server FIRST, before any UI
is shown, so a No is saved even if the customer closes the page immediately after."* That is a
real guarantee and it was deliberate. Its cost is that **whatever FETCHED the link is what
answered**, and plenty of things fetch a URL that are not the customer.

⛔ **It had already happened.** Eric Kling (#474, a work address) had `rsvp=no` fetched at
3:42am and `rsvp=back` at 4:07am from `X11; Linux x86_64 … Chrome/124` — a server browser, at
an hour nobody is answering email. Dayna Giles (#340, also a work address) the same. Corporate
mail gateways open every link in an incoming message to check it is safe, and an RSVP email
carries all three answers.

⭐ **Both attempts failed for an unrelated reason, and that is the only thing that saved
them.** A landed `no` moves a confirmed, paying customer to Maybe Next Year, and **nothing
anywhere records who submitted an RSVP** — so no audit could ever have said it was not him.
⚠ **So the failures are not the safety net.** Fixing `portalRsvp` without this would turn a
silent near-miss into a silent loss.

⭐ **A scanner can open a page. It cannot tap a button.** The link now draws the answer in
words — *"Yes — I'm in for this year"*, *"No — not this season"*, *"I'll be back next year"* —
with one gold button under it, and nothing reaches the server until it is tapped.

- ⚠ **The button names the answer, never a bare "Confirm."** They arrived by tapping a coloured
  button in an email and may not remember which one.
- ⚠ **One gate, both doors.** `handleRsvpLink` and `handleBackNextYear` each call
  `rsvpAwaitConfirmTap`; a second copy is how one of the three answers quietly goes back to
  recording on open.
- ⚠ **It fails towards NOT recording.** With the button missing it says so and stops. Proceeding
  would silently restore the exact behaviour this removes; a customer who cannot answer rings us,
  which is visible. `selector-contract.test.js` keeps the ids honest.
- ⚠ **`savePortalLogin` moved inside the tap too** — a bare open must leave no trace at all.
- ⚠ **And the answer table lives INSIDE the function, which is not tidiness.** Written as a
  module-level `var` beside it, it was hoisted as `undefined` and read before its own assignment
  line had run: `navigate()` is called some 2,500 lines above and reaches `handleRsvpLink`
  through `typeof handleRsvpLink === 'function'`, which a hoisted **function** declaration
  satisfies while a `var` is still undefined. The throw happened before anything was drawn, so
  the confirm row stayed hidden and no answer could be given at all — and **every source check
  passed.** Only driving the real page found it. Same shape as the `rmSaveGrade` scope error.

**What it costs, taken knowingly.** The old guarantee is gone: somebody who taps the email link
and closes the tab before confirming is now **not** recorded. That was put to Addie before it
was built. Do not restore the old ordering as a simplification — it is the bug.

⚠ **Every RSVP spec now taps.** Eleven spec files open RSVP links; they all go through
`tapRsvpConfirm` in `test/firebase-stub.js`, which reads the URL and no-ops on anything that is
not an RSVP link, so it can be called after every `goto` without the caller knowing which is
which. Eleven copies of a selector is how one of them keeps passing against a renamed button.

⚠ **And two existing checks were repointed, not weakened.** One asserted `portalRsvp` was call
`[0]` of any kind — true only because the answer used to go out during `navigate()`, before the
page-load `publicConfig` read came back; it names the PORTAL's own calls now, which is the
guarantee it was always about. The other looped two answers in one page and had to gain a real
reload between them: both URLs differ only by their hash, so the second `goto` is a hashchange
in the same document and the gate-code modal the first answer opened is still up, with its
backdrop over the page. Nothing about that is new — it only became visible once the test had to
click something.

#### And what the second read found (2026-09-11)

- ⭐ **Three of the four admin rows were one bug: a timer ticking after sign-out.**
  `detachAllListeners` stops every snapshot listener, and the guard inside `onSnapshot`
  forgives the permission denial that races it — but **neither of them reaches a
  `setInterval`**. All four of admin's long-lived timers went on running after a sign-out
  and after a token expiry alike, and each tick is a one-shot `getDoc`/`getDocs` that
  Firestore then refuses.
  - That is what a row reading **"Signed in as: nobody"** is. Two arrived within a minute
    of each other — *"[HU] activity log read failed"* and *"[HU] could not read nightly
    billing health"* — and neither names a fault in the thing it was reading.
  - ⭐ Every timer callback now goes through **`whileSignedIn`**, which returns on its
    first line while `HU_SIGNED_OUT` is set. ⚠ **A guard, not a `clearInterval`, and the
    reason is `initialized`** — that flag is set once inside `initData` and never put back,
    so signing in again without a reload does not re-run it. A cleared timer would stay
    cleared for the rest of the session and the restart guards (`if(hcAutoTimer) return;`)
    would hold it there. A tick that returns immediately costs nothing and starts working
    again the moment `HU_SIGNED_OUT` goes back to false.
  - ⚠ **It wraps the callback, never `setInterval` itself.** `connections.test.js` finds a
    long-lived timer by the variable it is assigned to and refuses an anonymous one, so a
    helper that took the interval over would make all four invisible to the page whose job
    is saying what runs by itself. That suite now sweeps the guard off the same inventory,
    so a timer added later cannot have the name without the guard.
  - ⚠ **And the two timer sweeps now strip comments first.** The explanatory comment on
    the new guard quotes `x = setInterval(` as the shape the sweep looks for, and the sweep
    read its own explanation as a sixth timer called `x`. Suites 58, 274, 275 and 300 each
    learned this from the other direction.
- ⭐ **"1 of 258 failed" now says which one.** The row carried the mail service's reason
  (*"The recipients address is corrupted"*) and no name, so there was no way to tell which
  of the 258 never heard from us — and under `confirmed-only` a customer who was never
  asked is a house no crew is sent to.
  - ⚠ **The answer was already being collected.** All five bulk senders build
    `failedRecipients` and hand it to `saveEmailSendFailures` ([[EM-01]]); only this report
    never got the list. It names up to five and counts the rest — `messages` is capped at
    5,000 characters on create, and a refused write is how this reporter goes silent.
  - ⚠ **And it pointed at the wrong screen.** *Email Setup* is where the keys live, which is
    right for a broken account and useless for one bad address on one record. It now points
    at **⚠ Some emails did not go out**, the card that names them and can resend to only
    those people.
- ⭐ **The paid-but-not-approved note was raising itself twice.** *"could not raise the
  paid-but-not-approved note for Suzette Robins — Document already exists:
  …/messages/0HcE7pW1ZaAuPdaNi5iQ"*. `addDoc` mints its own random id, so that is not a
  collision: it is the SDK retrying a write whose acknowledgement was lost — the long-poll
  reconnection noise §7 already names — after the first attempt had landed.
  - The throw then skipped the `arrearsPaidNoticeAt` stamp below it, so **the note existed
    and nothing recorded that** — and the next sweep raised the whole thing again, with a
    fresh id, for as long as the customer stayed unanswered. A duplicate note about one
    customer on every sweep is how the row stops being read.
  - ⚠ **The order of the two writes is unchanged and deliberate.** A raised note with no
    stamp costs a duplicate, which is visible; a stamp with no note costs the phone call,
    which is not. If the stamp cannot be written it goes back to retrying, exactly as
    before. `arrears-hold.test.js` **runs** the sweep twice over a stub for this, because
    the claim is about what a second pass does and a regex cannot see that.

### The Communication Centre — type, status, category, priority

Added 2026-09-09 ([[MSG-11]]). Addie's blueprint: *"Do NOT simply create more folders.
Instead, create a system based on MESSAGE TYPE → STATUS → CATEGORY → PRIORITY"*, and the
test she set for it — the office should answer, in seconds: who contacted us, what do they
need, do I need to respond, is somebody waiting on us, is the system having problems, is
any of it urgent, what is already handled.

⭐ **This supersedes the folder-shaped Inbox of [[MSG-05]]**, which was also hers. The old
answer is still right about what it was protecting — a tree is how you file something you
will look for later — but filing turned out to be the wrong FIRST question.

### Which of these also email the office (2026-09-11, [[MSG-17]] / [[MSG-18]])

A message landing in the Inbox and the office being TOLD about it are two different things,
and only the first is decided here. The nudge is one function, `notifyBusinessOfMessage` in
index.html, and the rule is **who acted**, not which folder the message lands in.

- **A member typed or did something → the Gmail hears about it.** All thirteen call sites:
  the site contact form and quick-message form, the portal's Contact Us form, a cancellation,
  a note added, a light-colour change, a wire-colour change, an outlet-timer change, a sides
  change, the three quote buttons (approve / maybe / decline), and — since 2026-09-11 — a
  **move**.
- **The app talking about itself → the Inbox only.** Nothing in `functions/index.js` or
  `admin.html` calls that function at all, so route-sweep notices, reconcile notes, member
  error reports and admin error reports reach the office screen and email nobody. That was
  already true and is now the stated rule rather than an accident.

⚠ **Three portal actions write `folder: 'System'` and still email** — light colour, wire
colour and outlet timer. They are filed as notices because the app wrote the sentence; they
are member ACTIONS, which is what decides this. Do not "tidy" them out of the alert by
reading the folder.

⚠ **The recipient address is not in this repo.** The params carry name, phone, email, topic
and message and no destination, so the *To Email* lives on the EmailJS template named by
`settings/emailjs.notifyTemplateId` (Admin → Automation Emails → Notify Template ID).
Nothing here can see it, and no test can prove where the mail went.

⛔ **AND IT WAS MISCONFIGURED FROM THE START — ALL THIRTEEN ALERTS WERE BEING REJECTED**
(found 2026-09-11, with Addie reading the EmailJS screens out loud). `notifyTemplateId`
pointed at **the customer template** — the one every invoice, RSVP and quote email goes
through — whose **To Email** is `{{to_email}}`. The alert sends no `to_email`, so EmailJS
refused every one for an empty recipient. Nothing had ever arrived: not a contact-form
message, not a cancellation, not a quote answer. It read exactly like a quiet season.

⚠ **THE TWO SENDERS PASS DIFFERENT THINGS, AND THAT IS WHY ONE TEMPLATE CANNOT SERVE BOTH.**
Admin sends supply `to_email` / `to_name` / `message` (+ `button_url`, `payment_link`…);
the public-site alert supplies `customer_name` / `customer_phone` / `customer_email` /
`topic` / `message` and **no recipient at all**. A template written for one renders blank
or is refused outright for the other.

⛔ **SO NEVER "FIX" THIS BY TYPING THE OFFICE ADDRESS INTO THE CUSTOMER TEMPLATE'S To Email.**
It is the tempting one-field repair and it would send all ~950 invoices and RSVPs to the
office instead of to the customers. Two templates, permanently.

⭐ **WHAT CORRECT LOOKS LIKE** (recorded because no test in this repo can see any of it, and
the only other copy is a screen on emailjs.com):

| | Customer template | Office-alert template |
|---|---|---|
| `settings/emailjs` key | `templateId` | `notifyTemplateId` |
| To Email | `{{to_email}}` | the office Gmail, **typed literally** |
| Subject | `{{subject}}` | `{{topic}}` — Addie's choice, 2026-09-11: offered with `— {{customer_name}}` appended so the inbox list says who each one is about, and she asked for the topic alone. The name is still the first line of the body. |
| Body | `Hi {{to_name}},` + `{{{message}}}` (triple — those bodies are HTML) | `Hi {{customer_name}},` + `{{message}}` (double — it carries text a customer typed) |
| Reply To | the office address, so customer replies reach a person | `{{customer_email}}`, so hitting Reply answers the customer |

⚠ **`customer_name` IS FILLED ON ALL THIRTEEN PATHS**, so the greeting never renders "Hi ,":
the three contact forms mark the name `required`, the portal actions read the signed-in
customer's record, and the quote answers read the quote. It is who TRIGGERED the alert, not
who sent it — and on a portal action it is the name on the ACCOUNT, so a spouse signing in
shows the account holder.

⚠ **AND THE TWO TEMPLATES MUST NOT BE NAMED ALIKE.** This bug existed because one template
was doing two jobs; the names are now the only thing keeping them apart, and opening the
wrong one to edit customer copy re-breaks the alerts silently.

⚠ **THE FAILURE IS STILL CONSOLE-ONLY.** `notifyBusinessOfMessage` logs a refusal and
nothing else — which is why this sat broken and looked like customers not writing in. It
does NOT file into Errors → Admin Errors the way other faults do. That is the gap worth
closing next; until it is, a rejected alert is indistinguishable from silence.

⭐ **And both directions are now driven in a real browser.** `test/address-move.spec.js`
presses the button and reads the alert back, and presses **Save Information** on My Info and
asserts NO alert — the regression guard that matters, because moving the call up into that
save would read as a tidy-up and silently undo [[QT-35]]. The nudge is observable at all
because `test/firebase-stub.js` serves a fake EmailJS SDK that RECORDS and resolves locally;
`api.emailjs.com` stays forbidden and `assertNoRealCalls` still runs, so a spec proving an
alert went is never the spec that emails the office. ⚠ It is **opt-in**
(`{ emailAlerts: true }`): `publicConfig` still answers not-configured by default, which is
what keeps every other spec's behaviour exactly as it was.

⚠ **The move alert hangs off the move button only.** `portalChangeAddress` writes its Inbox
note server-side and cannot send mail, so the nudge is raised in the browser once that call
returns `{ok:true}`. The ordinary My Info save is deliberately silent ([[QT-35]]) — a
corrected street spelling is not a move — so do not move this call up into it.

⭐ **WHERE A MESSAGE CAN BE FILED — ONE ANSWER** (2026-09-11, [[MSG-20]]). Addie: *"I still
can't drag and drop emails."*

- ⭐ **The drag was never broken.** Measured by RUNNING the real sidebar renderer against an
  ordinary season: **thirty rows drawn, none of them droppable.** Only a section or subtab she
  filled by hand takes a message; the five built-ins are saved filters, so a message dropped
  on one could not stay there. That exclusion is right and is kept.
- ⛔ **The other two ways of filing were reading a different list.** `populateMoveToSelect`
  and the right-click menu both walked `messageFolders` — the collection [[MSG-12]] emptied —
  so a folder she had just made was a drop target and in **neither menu**. Three routes to one
  place, two answering from a list nobody writes to any more.
- ⭐ **`msgFileableFolders` is the one answer**: Inbox first (it is not a folder document, and
  leaving it out makes filing a one-way trip), then her own folders, then any legacy name not
  already listed, never twice. The legacy names are kept — anything already filed would
  otherwise be reachable by search alone.
- ⭐ **And a drag now shows where it can land.** The nav takes a class for the duration and the
  CSS outlines whatever carries `data-commdrop`, so which rows accept a drop is stated once.
  When nothing can take one, the sidebar **says so** and names the way out — "nothing should
  fail quietly", applied to a gesture.
- ⚠ **One existing check was repointed, not weakened.** S273 matched the literal
  `<option value="Inbox">` — where that option happened to sit — so it failed on correct code
  the moment the list moved behind a name. It RUNS the rule now. 6 sabotages red-checked.
- ⚠ **`flatFolderList` no longer has a caller** and is left in place with a note saying so:
  `buildFolderTree` under it feeds `renderFolderNode` / `folderRowHtml`, which run-all still
  RUNS. Do not wire it back into a menu — that would be the second list all over again.

⛔ **The folders are gone** ([[MSG-12]], the same day). Once the system was in, Addie asked
*"can we just get rid of your folders altogether if the system is made?"* — and they had
become a second way of saying the same thing: every one of the eight the app created maps
onto a category she now has, and the error folders onto the System Errors section.

⚠ **Nothing was written to the database to take it away.** The `folder` field survives on
every record and is still read — `msgTypeOf` uses `folder === 'System'` to recognise
notices written before the topic list existed, so a season of old notices is still
classified correctly. The UI stopped offering folders; the data is untouched. That is what
makes it reversible.

⚠ **What is genuinely lost is hand-filing** — a folder she invented for her own purpose,
and `filedByHand` pinning a message to it. Categories are a fixed list and cannot reproduce
that. Fifteen checks were removed alongside the code they drove, with the reasoning kept in
run-all.js, so nobody restores them thinking a regression happened.

⛔ **And the three tabs across the top are gone** ([[MSG-13]]): *"we don't need a seperate
tab for this and completley get rid of employee messages."* Customer and System were tabs
across the top while the nav has them as sections down the side — the same choice offered
twice. ⚠ **Employee messages leaves an orphan, and it is said out loud rather than left to
be found**: `employee.html` still writes `employeeNotes` in two places and admin was the
only reader. It is acceptable only because the crew portal is not in use this season; if it
comes back, either stop that write or fold the notes in as an ordinary message type.

⛔ **Derived, never migrated.** Every classification is computed from what the record
already carries — `topic`, `folder`, `read`, `responded` — so it is right for a season of
messages already written, and there is nothing to undo if a rule turns out wrong. Only what
a *person* decides is stored: a status she sets, a priority she raises, a tag she adds.

| | |
|---|---|
| **Type** | `member` (somebody asking for something), `system` (the app reporting activity), `error` (something broke). Icon **and** word on every chip — *"Do not rely only on color"* |
| **Category** | tags, not folders, and a message may carry several. Her own example — *"red and green … and move my installation to November 20"* — comes out **Lights / Colors + Scheduling**, which no folder could hold twice |
| **Status** | Unread → Needs Reply → Waiting on Member → In Progress → Resolved → Archived |
| **Priority** | Urgent / High / Normal / Low. Nothing is urgent unless it broke something or she said so — *"Do not make every message feel urgent"* |
| **Severity** | errors only: Critical / Warning / Needs Review / Resolved |

⚠ **`responded` means Resolved, not Waiting.** That button has always meant *dealt with*;
reading it the other way would relabel every message she has ever ticked. **Waiting on
Member** is a new answer she sets herself, so it is stored and never inferred.

⚠ **A system notice never reads as Needs Reply.** Route notices outnumber real questions
hundreds to one, and burying the queue is the complaint this whole thing exists to fix —
the same argument the unread badge was fixed under in August.

⚠ **One rule, `commRowMatches`, decides both the list and every count beside every tab.**
Two implementations is how a tab says 5 and shows 4, which this Inbox has already done once.

The summary strip along the top is all buttons: *"Clicking '5 Need Reply' immediately
filters the inbox to those five."* Beside it sits **System Health**, which reads unresolved
errors rather than unread ones — "All systems operational" while two critical errors sat
there having been clicked once would be the panel lying.

*Where it's proved*: `comm-centre.test.js` (`npm run test:comm`) RUNS the classifier over
real message shapes, including her worked example, rather than matching its source.

**The sidebar is yours to shape** ([[MSG-15]], 2026-09-09). Addie: *"for inbox I have no way
of adding anything deleting anything or adding a whole new section with subtabs? Can we get
that added so I can make it like this?"* **＋ New section** at the bottom of the sidebar
builds one: a name, an icon, what belongs in it, and as many subtabs as you like — the same
shape as Member Messages and its five.

⭐ **THE RSVP NOs HAVE THEIR OWN SECTION** ([[RS-59]], 2026-09-11). Addie: *"can we have no
emails be there own section and it will go in the folder with the response they choose"*, then
*"I mean No RSVPs."*

⛔ **Nothing was written to the Inbox at all when somebody declined.** `portalRsvp` recorded the
answer, pulled them off every upcoming route, queued their lights for recycling and took their
referral back — and the one list the office reads every morning said nothing. A customer saying
no is the most consequential answer in the season and it was the quietest thing that could
happen, so the note had to be invented before a section could hold one.

**The topic IS the folder**, which is her rule said literally: **RSVP — Not This Year** and
**RSVP — Back Next Year**, two topics rather than one with a field, because the two are
different decisions — one queues a recycle and puts their customer number back in the pool, the
other keeps them on the books for the season after — and the two notes say different things
about what happens next. ⚠ **They are system notices, never member messages**: on a send of
~960 they outnumber real questions, and read as member mail they bury the reply queue.
⚠ **Raised on the transition only**, so re-opening the link does not fill the folder with
duplicates, and **best effort**, so a failed note never undoes an answer already recorded.
⛔ **The office's own "no" raises nothing**, deliberately — somebody in admin setting a customer
to No already knows, and a note telling them what they just typed is noise.

⭐ **AND A FOLDER PER REASON** ([[RS-60]], the same day). This line used to read *"an RSVP
decline has no optional reason picker — it is a single button"*, which is what she was told, and
her answer was *"okay i need it to be optional choice"*, then *"Should be Moved, Finances, etc."*
The section now carries a tab per reason under the two answer tabs, built from the shared
`RSVP_DECLINE_REASONS` list rather than typed out, so the folders cannot drift from what the
customer is offered or from what the server files them under.

⚠ **The `why:` tab reads the reason off the MESSAGE**, never off the customer record — the same
rule as the two answer tabs. A message is what somebody said on a day; re-deriving it from the
record would shuffle old notes between folders every time a customer changed their mind.
⚠ **A decline with no reason is in no reason folder and still in its answer folder** — the
reason is optional, so that is the ordinary case, and treating a blank as a match would put
every silent decline into whichever folder sorts first.
⚠ **And a reason never drags a note out of its answer.** What they said and why are different
questions, so a Moved back-next-year is in **Back Next Year** and in **Moved**, never in Not
This Year.

⭐ **AND THEN SHE NAMED THE WHOLE THING** ([[MSG-19]], 2026-09-11). Addie, across five
messages: *"on inbox we need to be able to add a folder to each section not just a new
section"*; *"in what type does this belong to we should have a spot for nothing so we can just
move emails into it for my completed folder"*; *"I also don't like the filters you set for me
we can just put everything in inbox and we can choose what section they go in from there. Then
put them in completed afterward. In other words I can choose what all sections are called and
all folders are called"*; *"And I need to be able to put emails in the folders as well like
drag and drop."*

⛔ **This paragraph used to read "a section is a saved filter, not a folder — nothing is moved
into a section",** and that was [[MSG-15]], which was also hers. She reversed it, so the newer
answer is the one the app follows (R-024) and the old row is marked Superseded rather than
deleted. **What it was protecting is still protected**, and this is the part to keep: a view
she fills by hand asks the MESSAGE which folder it is in — the same `folder` / `filedByHand`
pair the drag, the right-click and Move to… have always written — so no section holds a list
of its own, two views can never disagree about one message, and deleting one strands nothing.

**Every view now answers one question first: what goes in here?** Either *Nothing — I move
messages in myself*, which makes it a folder, or *anything matching the ticks below*, which is
the filter as it was. **A new section and a new folder both start on the hand-filled answer.**

**The Inbox is the pile nobody has filed yet.** Move something and it leaves — otherwise the
Inbox never shrinks and the filing buys nothing. ⚠ **Hand filing only**: a cancellation
request files itself into Cancellations off its topic with nobody having touched it, and those
stay in the Inbox, because they are unfiled work that happens to have a home.

⚠ **Nothing can become unreachable.** Any folder holding filed mail that no section points at —
including everything filed before any of this existed — is listed under **Your folders** at the
bottom of the sidebar, and can be opened and dropped into. **Deleting a hand-filled section
puts its messages back in the Inbox first**, and says how many.

**Every section is editable, the four built-ins included** — rename it, change its icon, add as
many folders as you like. ⛔ **But not redefined**: what lands in one of the four to begin with
is code and every dashboard tile counts it, so the editor says so rather than offering a
control that would break those tiles. They can still be hidden, never deleted.

**The folder she names IS the message folder** — a real `messageFolders` document is created
with it, so Move to…, the right-click menu and a drag all know the same names.

**What a by-rule filter is made of:** message type, category, status, priority, and optionally
words that must appear. Nothing ticked in a row means *any*; ticks in different rows must **all**
match. A subtab **narrows** its section and can never reach outside it, so a Payments subtab
under a Member section shows member payment questions, never system payment notices.

**Every filter shows a live count while you build it**, so you can see what a tab will hold
before saving. Nothing is written until **Save** — Cancel leaves everything as it was.

**The four built-in sections can be hidden, not deleted.** They are the spine the dashboard
tiles are built on, so deleting one would leave those tiles pointing at nothing. Hidden ones
are listed at the bottom of the sidebar with a one-click way back. ⚠ Since [[MSG-19]] they
also carry the pencil, for renaming and for adding folders — hiding is what "deleting" means
for a list she did not make.

⚠ Sections live in `settings/commSections`, one small document. If two people edit sections
at the same moment, the last save wins — they change rarely enough that this is the right
trade, and it is the same one the scheduling settings already make.

**Every light change is charged $30, whichever screen it was typed into** ([[MON-78]],
2026-09-11). Addie: *"anyone that does a light change or ends up in warehouse because of a
light change besides requotes and quotes will need to be charged 30 dollars unless waived"*,
then *"Yes either light change made in member portal or in costumer admin portal."*

⛔ **The office had two doors onto one change and only one of them charged.** Edit Customer
asks and charges; the **All Customers row panel**, which has its own lights picker, queued the
warehouse colour change and wrote the new colours to the record and to the invoice — and
charged nothing. So what a customer paid depended on which box somebody happened to type into,
and neither they nor their bill can tell the difference. It also never stamped
`lightsChangedAt` or `lightsChangedVia`, so a change made there was invisible to the fee path,
to the workbook's Color Changes tab and to the warehouse's build badge as well.

It now asks first — **charge, waive, or cancel the whole save** — reads the free window and
the sent bill off the record rather than assuming neither, and asks `houseLightsText` what
they had (both colour fields, per [[WH-28]] below). ⚠ **The 48-hour free window is untouched**:
a change inside it is still free. ⚠ **Re-quotes and new quotes are still exempt** — that is her
*"besides requotes and quotes"*, and a first-time colour was never a change anyway.

⚠ **One fee writer, not a third copy.** `addLightChangeFeeToInvoice` and
`lightChangeCarryoverUpdates` are shared by both doors: two copies of a money write is how one
screen starts charging what another does not.

**Why some light changes never showed a $30 fee** ([[WH-28]], 2026-09-10). Addie: *"there are
member that did light changes but are not showing 30 dollar fee on there account."*

A house's colours live in **two** fields. The master-sheet sync only fills `lightsDescription`
when a colour *repeats* (an alternating pattern, where the order matters); an ordinary house
keeps its colours in `lightColors` and its description is empty. The fee was reading the
description alone — so those houses looked as though they had **no colours at all**, and the
rule that filling colours in for the first time is free (correctly) charged nothing. In
practice that was most of the imported book.

⭐ **The portal picker had the same hole, and that is the half that made it unfair.** It filled
from the description alone too, so a customer who already had colours opened the page with
**nothing selected**, picked some, was warned about $30 — and then was not charged. The
warning and the charge disagreed. Fixing the money without fixing the picker would have
charged people for filling in what looked like a blank.

⚠ The rule that decides the fee was never wrong, and the parity test between the office and
the server copies has been passing correctly the whole time. What was wrong is what the caller
handed it. `houseLightsText` is the one answer to *"what colours does this house have"*, and
the fee is the sixth reader brought to it.

**And how they asked to be reached** ([[MSG-16]], 2026-09-10). Addie: *"we can no longer see how
someone prefers to be contacted."* It had not been removed — it was sitting in the small grey
line with the date, which is the line that stopped carrying anything you needed once the phone
and email moved up. It is now **on the contact line**, against the detail it is about:
*Text them* beside the number, *Email them* beside the address.

⚠ Call and text are shown as **different instructions**, never as a highlight on the same
number — ringing somebody who asked to be texted is the whole thing this prevents. Anything
that isn't one of the three is shown **exactly as written** rather than guessed at.

⚠ **If they asked for something we do not have** — an email preference with no email on file —
the row says so in red. That used to be invisible: it looked like an ordinary row with a phone
number on it and nothing saying they had not wanted it used.

⭐ **The phone and email are plain text with a Copy button, not links** — Addie: *"I want to be
able to copy and paste phone number and email but not a link."* This reverses half of
[[MSG-14]], which made them `tel:`/`mailto:`; the older reasoning was sound (on a phone a link
is one press) but it cost the thing she actually does, because dragging to select inside a link
follows the link instead. **Copy takes exactly what is on screen** — the number with its
punctuation and extension, the address as typed. If the browser refuses to copy, it says so
and tells you to select and press Ctrl+C; it never just does nothing.

**How to reach them** ([[MSG-14]], 2026-09-09). Addie: *"on inbox can you show email and
phone number under name so I can communicate with them?"* The phone and the email now sit on
their **own line directly under the name**, as a `tel:` link and a `mailto:` link she can
press.

They were on the row before this, which is not the same thing: both were buried in the small
grey meta line, run together with *"Prefers text"* and the date — so the one thing on the row
she has to act on was set in the same type as the one thing she never needs. That line now
holds only the preference and the date.

⭐ **And the message is not the only place it looks.** A message carries whatever the sender
typed, so a portal-raised one often has a phone and no email, and a Member Error has neither
— the row above had just learned to *name* those customers and still gave her no way to ring
them. If a detail is missing, it is filled in from the customer record, found by phone, by
email, or by the same portal-token match as [[MSG-10]].

⚠ **A detail that matches two people resolves to nobody.** Seventeen phone numbers in the
real book are shared and fourteen of those are two genuinely different households; a shared
email is as ordinary. Giving her the wrong person's address on a screen whose whole purpose
is writing to them is worse than giving her none — so an ambiguous match is refused, and
whatever the message itself carried is still shown.

⚠ **What they typed always wins.** The record only ever fills a gap, because somebody
writing in from a new address wants the reply there. Anything taken from the record is
labelled *from their record*, so she can tell their own answer from one worked out on their
behalf.

⚠ **A System notice gets no contact line at all** — there is no customer behind a route
sweep. On a member row that genuinely has nothing, the line *says* so; blank would read as
nothing-to-do-here on a message somebody is waiting on.

⚠ **If a number looks wrong, check for an extension.** A number typed as *"(801) 555-0999
ext 4"* used to become `tel:+180155509994` — eleven digits, dials perfectly, reaches a
stranger. The link now stops at the first letter, and a number too short to ring is shown
without being made a link at all.

**Who hit it** ([[MSG-10]], 2026-09-09). Addie, reading a folder in which one row was named
and the rest were blank: *"we need to know who hit an error so you need to show me who hit
that error."* Three different things were happening in those rows, and only the first was
what it looked like:

* **Signed in through the portal** — already named, and always was. A failure inside the
  account knows exactly whose account it is.
* **Signed in the ordinary way** (phone and surname) — was blank, and should never have
  been. The reporter read `currentJobAddressData`, which only the token route fills; every
  other reader in that file asks for `currentJobAddressData || currentLookupRecord`. It
  does now too.
* **An RSVP link that failed before sign-in** — genuinely had nobody to name, and these are
  the rows that matter most, because to that customer it looks like they already answered.
  The link carries their own token and the report already wrote its **last six characters**
  down; the office holds `portalToken` on every customer, so the Inbox now matches the two
  and prints the name, marked *"matched by their link"* so it is never mistaken for one the
  page reported.

⚠ **It reads the rows already filed**, not just new ones — those carry the tail only inside
the page address as prose, and they are the rows she was looking at. New reports also write
`tokenTail`/`tokenKind` as fields. ⚠ **Two candidates names neither**, because naming the
wrong customer on a report about a failure is worse than naming none. ⚠ **A `quoteToken` is
never resolved against the customer list** — same shape, different collection. ⚠ **And the
whole token is still never written down**; this widens what the office can see, not what is
stored.

⚠ **Both sides stop themselves.** Each dedupes on a fingerprint with the numbers stripped
out, so 900 failed rows are one fault rather than 900. The member side stops after three
per visit; the admin side after five per session, and stays quiet about a fault already
written down in the last twelve hours. Without that last one a fault that fires on every
page load posts a fresh row every time the tab is opened — which is how a folder becomes
one nobody opens.

⚠ **A portal token is never written down in full.** The address the customer was on is the
most useful line in the report and it carries theirs. `messages` is staff-read-only but
publicly *creatable* — that is how the contact form works with no login — so the token is
cut to its last six characters: enough to match a record, useless to anybody who finds it.

⚠ **It is a best effort, by construction.** The report is itself a Firestore write, so the
one failure it can never carry is the network being down altogether. That is not a hole to
plug; it is why the customer is still shown a phone number.

⚠ **The Firestore reconnection line is deliberately not reported.** `Fetch failed` on the
long-poll channel is normal noise (§7 of CLAUDE.md), it arrives in bursts, and left in it
would fill the folder on a flaky connection.

*Gated by* `error-inbox.test.js` (`npm run test:errors`), which runs both reporters against
a fake Firestore rather than reading their source; 16 sabotages red-checked.

---

## 6. Customer Numbers

- **The bin cutoff** (320 ft — see §2) decides regular-series (1 bin) vs 5000-series (2 or more bins). Only two series exist, so the test is "more than one bin", not "exactly two".
- **Pool**: `availableCustomerNumbers`, one doc per free number, `{type, releasedAt, releasedFrom}`.
- **Assign**: lowest free pooled number of the right type wins; if the pool is empty, the next number above the current highest is used.
- **Release**: freeing a number (edit, removal, recycle) drops it back into the pool.
- **Bulk assign**: a paste-in tool that matches pasted names/streets/numbers against existing customers by normalized name/street and stamps the number on — it does not touch geocoding or addresses.

---

## 7. The three portals

### Public site + Member Portal (`index.html`)
- **Anonymous**: quote form, public content (reviews/gallery/hero images/FAQ/site content), general contact message.
- **Signed in** (phone-or-email + last name, or a personalized token link): Payment (balance + tip + PayPal/Venmo), Information (name/phone/email/address/gate code), Light Colors (subject to the 48-hour fee window), Changes (RSVP + preferences), **Refer a Friend**, Contact, Cancel (requests cancellation).
  - ⭐ **The payment panel puts Venmo last** (2026-09-01). Card and PayPal are the visible options; Venmo sits inside a closed **Other payment options** dropdown, and the Venmo **QR code has been deleted** — it was a ~30KB image on every load that asked the customer to type the amount in themselves. The dropdown is a plain `<details>`, shut by default with no JavaScript, and re-shut on every render so a tip or an instalment cannot leave it hanging open.
  - ⭐ **A customer carrying last season's debt pays that first, and the bill shows the two apart.** Last year's balance gets **its own card above this season's**, each with its own subtotal — Addie: *"I need the unpaid last year to look more obvious but still nice and organized."* `paypalCreateOrder` charges the carried balance and nothing else while it is outstanding; once it is paid, the same button comes back offering this year's. `renderArrearsNotice` says so in words, because a button charging less than the balance above it reads as a mistake or a double charge. Proved on the real page by `test/arrears-portal.spec.js`.
    - ⚠ **The total above the button reads `portalPayableNow()`, not the whole balance.** It was `currentServiceDue = totalDue` and had never been repointed when the button started charging only the arrears — so the panel printed **Total Payment $1,146.00** directly above a button that would take **$200**. Addie saw it and reported it; the specs at the time proved the notice and the button and never looked at the total between them.
    - ⭐ **There is also a way to clear the whole account**, for somebody who does not want to pay in two goes.
    - ⚠ **A tip goes to the crew, not onto the bill.** `paypalCaptureOrder` used to call everything above the balance due a tip (`serviceAmount = min(captured, balanceDue)`), which was right while the button charged the whole bill and **wrong from the moment it stopped** — so while only last season was being charged, a tip landed on the bill instead of reaching the crew. Live from the day the split shipped, and invisible from the screen.
  - ⭐ **Moving house has its own button, and it applies nothing** (2026-09-10, QT-35). Addie: *"changing gate code or phone number should not notify us"*, and *"you should have to apply changes in order for it to go to requote."* The address box on **My Info** is still editable — that is how a typo or a missing apartment number gets fixed, and neither is a move — but **Moved house?** opens its own small form and calls `portalChangeAddress`.
    - ⚠ **What was wrong**: `portalSave`'s `info` section decided somebody had MOVED from nothing but the address STRING having changed, and wrote a re-quote state on **every** save of that tab (`address_changed` if the string differed, `needs_changes` otherwise). index.html raised the quote card itself in the same breath and emailed the office. So correcting a spelling produced a card somebody had to answer; correcting a phone number parked them in Needs Changes with no card at all, for ever. No comparison of two typed strings can tell a correction from a move — which is why this is a button.
    - ⭐ **The move is RECORDED, never applied.** It writes `pendingAddress`/`pendingCity`/`pendingZip`/`pendingMoveDate`/`pendingAddressAt` and leaves the live `address`, the town and the map pin exactly as they were. ⚠ **There is no geocoder on the server** and the **town is what a crew-day is grouped by**, so applying it there leaves the customer at the new house with the OLD house's pin, on the OLD town's day, with the new address already pushed onto a frozen route stop the crew is holding.
    - ⭐ **The office's own Save is the one writer.** Edit Customer shows a banner with both addresses and the move date; **Apply fills the boxes and writes nothing**, and pressing Save re-geocodes, raises the re-quote with `existingCustomerId` and re-syncs upcoming stops — the path that already does all three, rather than a second writer that would do one.
    - ⚠ **The badge is the half that was kept**: `seasonStatus: 'address_changed'` is the pill on the customer row and the filter the office works from, and it clears when the re-quote is answered (`QUOTE_RAISED_STATUSES`). ⭐ **And ONLY by the re-quote, as of 2026-09-11 (QT-37)** — see the bullet below. Written through `stampSeasonStatusServer`, not by hand — that helper exists because a stamp beside any ONE branch misses the others, and this is its fourth writer; it is also what puts the move on the customer's **history**, where `historySeasonWords` already reads `address_changed`.
    - ⚠ **The portal is told its request landed.** The live address stays the old one on purpose, so without a banner the tab looks like it lost the form and they send it again. Only `pendingAddress` and `pendingMoveDate` are on the read whitelist; the other three are deliberately not, because no line of the page looks at them (`portal-fields.test.js` is what said so).
    - ⚠ **And the request is retired by the save that grants it** — on the address having **changed**, not on it matching what the customer typed. The office routinely tidies a street name, and an exact test would leave the banner advertising a move already applied for the next person to apply twice: the sticky-field bug this repo shipped once as `maybeNextYear`.
    - Gated by `address-move.test.js`, which RUNS the callable against a fake Firestore and reads the update object back — the central claim is a NEGATIVE (no address, no town, no pin) and a source search cannot see one. 12 sabotages red-checked.
    - ⭐ **AND ANYONE MAY REPORT ONE, PAID UP OR NOT** (2026-09-10, QT-36). Addie: *"Yes anyone can report a move but when we requote the person that didn't pay for last year still can't be scheduled until they pay there balance."* So `portalChangeAddress` is **the one portal write deliberately NOT behind the arrears hold** — `portalSave` refuses every section but `cancel` while last season is unpaid, which makes this look like the door that forgot its guard. It is not; it is her exception, and it is asserted as code so a "tidy-up" goes red.
      - ⚠ **THE HOLD IS ON BEING SCHEDULED, NOT ON TELLING US**, and that is the whole reconciliation with Dax's *"before anything goes into the system"*: a pending address grants nothing. `houseOwesFromLastSeason` inside `isOutForSeason` — tested AHEAD of the rsvpStatus and Confirmed branches — keeps a debtor off the routes, out of the build queue and off the schedule even after the office applies the move, re-quotes them, and they APPROVE it. `placeUnscheduledOnNextDay` refuses anybody it holds, so the `needsDayAssignedAt` a yes stamps does not place them either.
      - ⚠ **NOTHING WAS BUILT FOR THAT SECOND HALF** — it was already true and already pinned. `arrears-hold.test.js` §4d runs the real `seasonYesUpdates` into the real `isOutForSeason` for the email-approval path, which is the same `quoteRespond` route a move re-quote takes. Verified before writing anything rather than assumed.
    - ⭐ **AND NOTHING BUT THE RE-QUOTE MAY CLEAR THE BADGE** (2026-09-11, QT-37). Addie, shown the drift and asked whether to tighten it: *"go ahead."* Three places used to clear a quote-raised `seasonStatus` back to `confirmed` — an **add-on refusal**, a **same-as-last-year refusal**, and the office **deleting a re-quote** — on the argument, written into `QUOTE_RAISED_STATUSES`' own note, that anything sitting there was put there by THIS quote. That was true when it was written and is still true of `needs_changes`; the move door made it a **second writer of `address_changed`**, answered only when the office applies the move, and all three were clearing that too.
      - ⚠ **What it cost, said accurately**: nothing routed and nothing billed. `seasonStatus` is read for **display only** — the pill and the history line — and the pending move itself survived either way, because the Edit Customer banner reads `pendingAddress` rather than the status. What went was the one signal on that row saying a house we have not re-quoted is not settled.
      - ⭐ **One rule per side**: `quoteAnswerMayClearStatusServer` (both server sites) and `quoteAnswerMayClearStatus` (the office delete). It asks about **`pendingAddress`** — the same field the banner reads and the same field the Save clears once the address has moved — and deliberately **not about the status word**: there is only one `seasonStatus` field, so a move can be outstanding while the pill shows `needs_changes` because something else wrote last.
      - ⭐ **The hold is bounded, which is the whole argument for it.** The hole the clearing closed is a customer sitting in Needs Changes for ever with nothing anywhere to clear it; here there IS something left — the move, which the office applies, and that save clears `pendingAddress` and raises the re-quote that answers the badge properly. **It reports nothing and flags nothing**: the badge still reading Needs Changes is the honest answer while a move is outstanding, and a follow-up raised for correct behaviour is how the office learns to click past the ones that matter.
      - ⚠ **All three sites, not the one that prompted it** — "a fix in one direction is half a fix". Proved where each half can be: the **behaviour** in run-all.js Suites 137 and 138, which already drive both decline paths against a fake Firestore (the status survives, and an `address_changed` with **no** pending move still clears); the **agreement** in §5 of `address-move.test.js`, which RUNS the two copies side by side over every shape a record can be in, money-parity's argument applied to a badge. 6 sabotages red-checked.
- ⭐ **STAYING SIGNED IN, AND STILL BEING ABLE TO LEAVE** (2026-09-11, [[MEM-01]]). Addie:
  *"make sure when someone logs into member portal they stay logged in but they can still go
  back to home page with a go back button or something in top right corner."*
  - **The way back is top right, beside Log Out** (`portalBackToSiteLink`), and it reads
    BEFORE Log Out — the one neighbour that cannot be undone. It MOVED from the left rather
    than being added: two controls making the same promise is a coin toss.
  - ⚠ **The sign-in half was already true**, and was driven in a browser before anything was
    written: the way back keeps the token, and the header's Member Portal button walks
    straight back in with no second sign-in.
  - ⛔ **What was actually wrong is the other half.** A remembered login redirects the bare
    site to `#/payment` at start-up, so a customer who had just asked for the home page was
    put back into their account by the next reload — and a refresh, a bookmark and tapping
    the logo are all reloads. Pressing the way back now leaves a per-tab note
    (`sessionStorage`, `huPortalStayOnSite`) that stands the redirect down; asking for the
    portal again takes it back, in the router rather than on the five links that point there.
  - ⛔ **The redirect is not removed and must not be.** Its own comment names who it is for:
    somebody arriving from an email who wants to land on their pending item. This defers only
    to a person who has SAID otherwise, in the tab they said it in.
  - ⚠ **It suppresses the redirect away from the site and nothing else.** A refresh INSIDE
    the account still comes back signed in; a flag written over both branches of that test
    would log them out there, and a red-check caught exactly that sabotage passing, because
    walking back into the portal clears the note and no click path can reach the state. That
    invariant is staged by hand in its own test for precisely that reason.
  - ⚠ **The storage key is written out in all three helpers, never held in a constant.** They
    sit below the start-up block that calls them, and in one ES module a `function` hoists
    while a `var` beside it hoists as **undefined** — a named key would read
    `getItem(undefined)` at the only moment that matters and the feature would never work,
    silently, with every source check green.
  - Gated by `test/portal-stay-signed-in.spec.js` — seven tests, all RUN, because every claim
    is about a control on the screen or about what survives a **reload**, and a `goto` that
    only changes the hash never re-runs the start-up block. 5 sabotages red-checked.
- **Cloud Functions it calls**: `portalLookup` (the one entry point for all lookups — token or phone/email+lastname, rate-limited), `portalSave` (whitelisted writes per section, mirrors changes onto the invoice, resyncs upcoming routes), `portalRsvp`, `portalSetGateCode`, `portalChangeAddress` (records a move as PENDING; applies nothing), `portalInvoice` (sanitized invoice read), `quoteRespond`, `publicQuoteLookup`, `paypalCreateOrder`/`paypalCaptureOrder`, `publicConfig` (public-safe EmailJS keys for the contact form).

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
- **When somebody pays off last season but has still never answered the RSVP, a note lands in the System inbox** — because that is the one moment nothing else reports: they quietly leave *Owes from last year* and are still not scheduled. It hangs off the invoices listener, so it catches a payment however it arrived (the Paid/Partial dropdown, a PayPal capture, or the importer), and is raised once per customer per season. Only for people who have said nothing — somebody who said no or Back Next Year has answered (RS-30).
- **Nobody held for last season's debt is chased automatically.** Addie sends those herself. The nightly run only emails a bill once every house on it is complete, and a held customer never gets there — so their bill sits on their portal, they are named under Schedule → Owes from last year, and they appear in the Unpaid/Partial email audiences (MON-34).
- **Owing money from last season keeps you out of the season too**, on top of the RSVP rule and independently of it — a yes is not a payment. Start New Season carries the unpaid balance onto the new bill as its own `kind: 'arrears'` line, and `isOutForSeason` holds them until the whole of that amount is covered by payment or credit. They are listed under **Schedule → Owes from last year** (§3, MON-31, RS-24).
- **And the RSVP says so to their face rather than promising a crew** (2026-09-01). A yes from a debtor used to end on *"We'll get you scheduled!"*, which is the one thing that was never going to happen for them. It now names the amount and the season and says the install cannot be booked until it is settled — on both screens, because the follow-on message is where that promise actually lived. Their yes is still recorded, nothing is sent (so it is not MON-34's chase), and an invoice that cannot be read reports nought and leaves the old wording alone. Full reasoning in §3.
- A legacy customer record without a `portalToken` gets one minted automatically the first time they're looked up.
- Nightly-run failures/results text the owner via Twilio — a separate channel from email, so it still works if email itself breaks.

---

## 9. Things that look automatic but aren't (or no longer are)

- **Quote photos**: Street View auto-lookup was retired. `frontPhotoUrl` is `null` on every new public quote — but it's *not* dead. Staff add/replace/markup the photo by hand directly on the quote card in Admin, and it carries across to the customer record on conversion. (An earlier internal note flagged the admin reads of `frontPhotoUrl` as dead code to remove — that note was wrong; removing those reads would have broken the working manual-photo feature. Confirmed by the code comment in `index.html`: "Automatic Street View photo lookup was retired — photos are added by hand on the quote card in the admin.")
- **The two opt-out flags, and what each one does NOT stop.** Both live on `jobAddresses` and both are deliberately narrow.
  - `smsOptedOut` (+ `smsOptedOutReason`) — set automatically when somebody replies STOP to a text, or by hand via the **Don't text this customer** tick in Edit Customer. It hides the "Send as text instead" button on the quote card. It does not affect email.
  - `noAutomationEmails` — the **do-not-send list** (added 2026-08-21). Set two ways, both writing the same field: the *Don't send* button beside a name in Automation Emails → Preview & Send, or the **Don't send this customer marketing emails** tick in Edit Customer. Cleared by *Allow again* in that panel's "Show who I've excluded" view, or by unticking. Read by the Preview & Send recipient list, which is now the **only** automation-email sender — the older Send Template modal was deleted on 2026-09-04 (see *Filter, then select everyone under the filter*). Somebody on it is dropped from the list before rendering, so **Select All cannot reach them**; their tick is also dropped the moment the list redraws if they were ticked before being added; and the send loop checks a third time at send time.
  - **Where a preference is visible.** `CONTACT_PREFS` in `admin.html` is the one list of ways somebody has asked not to be contacted, and three screens render from it: the two tickboxes in Edit Customer, a red chip per preference on the All Customers row, and a muted line on the printed invoice (*"Contact preferences: no text messages."*). Somebody who has asked for nothing gets no line at all — printing "preferences: none" on every invoice trains the eye to skip the place the real ones appear.
  - ⚠ **The invoice prints preferences and can never act on them.** `contactPrefsNote(d)` returns a finished string, and `buildInvoiceDocHtml` is handed that string rather than the flags — so nothing in the invoice builder can branch on a contact preference, because it never receives one. Suite 128 asserts the builder names neither field directly. The Edit Customer tickbox says outright that they still get their invoice and account notices, since the one dangerous misreading of that box is that it stops their bill.
  - ⚠ **`noAutomationEmails` never stops a bill.** It is named for its scope on purpose — the obvious name (`emailOptedOut`) invites someone to wire it into the nightly invoice run, and a customer who asked to stop getting marketing would then silently stop being **billed**. Nobody chases an invoice that was never sent. Neither `functions/index.js` nor `buildInvoiceDocHtml` has ever heard of the field, and Suite 128 of `run-all.js` fails if either learns it.
  - ⚠ The four other email-send handlers in `admin.html` (`sendRsvpEmailBtn`, `sendBulkUpdateEmailBtn`, `pibSendUnpaidBtn`, `pibSendPaidBtn`) have **no markup** — every id is in `KNOWN_MISSING_IDS`, so they return at their first line. That is the only reason they carry no guard. Suite 128 fails if any of them ever gets markup, so whoever builds one has to decide about the list first.
- ⭐ **THE WHOLE RSVP, IN ONE PRESS** (2026-09-07, RS-53). Dax: *"We want one button for the
  entire rsvp"*, and *"we need everyone to get the right email and hve it sent to the right
  spot."* **Automation Emails → Templates → Send the whole RSVP.** The season RSVP used to be
  three screens — the ordinary email here, the Not Paid one under Invoices, and the text list
  below — and the one send that must reach everybody exactly once is the worst possible place
  to rely on somebody remembering the order.
  - **What one press does.** Plans the whole book, shows the breakdown, then sends the
    **ordinary RSVP** to everybody who is straight and the **Not Paid RSVP** to everybody who
    owes from last season. Marks `rsvpSentAt` once, at the end, and redraws the text list.
  - ⚠ **It is not a second sender.** It calls `etSendTemplateRun`, the same loop the ordinary
    Send button uses. It decides *who* and *which template* and nothing else.
  - ⛔ **It refuses entirely until the invoices have loaded, and that is the most important
    line in it.** Before that read lands `houseOwesFromLastSeason` answers false for
    everybody — so an ungated press posts the ordinary *"will you be getting lights hung again
    this year"* email to every customer carrying a balance, saying nothing about the balance
    and handing them a Yes button that cannot put them on the schedule. ~950 wrong sends from
    one press, silently. It says which tab to open rather than looking like nothing happened.
  - ⚠ **Both templates or neither.** Sending only the half that has a template leaves the
    other half unasked with nothing on screen saying so — "send the whole RSVP" having sent
    some of it is the failure this button exists to remove.
  - ⚠ **Nobody is in two lists.** Straight, owing, to-be-texted, do-not-send, already
    answered and first-year are six disjoint outcomes, and the suite asserts that as a
    property rather than case by case.
  - ⚠ **Check first runs the same planner and sends nothing**, so what is on screen is what
    sends — the same reasoning the Preview & Send preview and its send loop already share.
- ⭐ **ONE SENDER, HOWEVER MANY TEMPLATES A RUN NEEDS** (2026-09-07). The send loop used to
  live inside the *Send to N selected* click handler, so any second button could only have
  reached it by growing a second copy — which is the failure this repo already fixed once by
  DELETING a second sender (RS-52). It is now `etSendTemplateRun`, **moved rather than
  retyped**, and every rule in it is the shipped one: the do-not-send gate at send time, the
  quote token, the add-on block, the referral block, the per-kind subject. The button
  delegates and keeps only its own validation, confirm and marking.
  - ⚠ **It deliberately does not mark the RSVP sent.** A run may be several passes over
    several templates, and `rsvpSentAt` is one fact about the *season*, not one per pass.
    Marking inside would stamp it twice and report the season live before the second half of
    the book had been written to. The caller marks, once, at the end.
  - ⭐ **AND IT NAMES WHO IT FAILED FOR, SO THEY CAN BE SENT TO AGAIN** (2026-09-09,
    [[EM-01]]). Addie, after a send where 392 did not go out: *"We need to be able to send it
    again to failed recepients."* The report said 392 had not been emailed and named **nobody**,
    so the only way to reach them was to send the whole book a second time — mailing everybody
    who already had it twice. `etSendTemplateRun` now collects a `{id, name, email, why}` row
    for every failure and hands them back; **⚠ Some emails did not go out**, a red card under
    *Send the whole RSVP*, lists them and sends to only those people.
    - ⚠ **Why it is worth more than an unsent email usually is.** `SEASON_ELIGIBILITY` is
      `confirmed-only` and `seasonRuleIsLive()` is true, so a customer who was never asked
      cannot answer, and `isOutForSeason` therefore has them **off the routes, out of the build
      queue and off the schedule**. An email that quietly did not arrive is a house no crew is
      sent to. That is why the card says so in as many words, and why `loadEmailSendFailures`
      is eager at login rather than waiting for something to draw it.
    - ⚠ **The list is kept per template, never as one list of ids.** *Send the whole RSVP* runs
      the sender **twice** — the ordinary RSVP, then the Not Paid one — so a merged list would
      send the ordinary email to somebody who owes from last season, the exact mix-up that
      button exists to prevent. Each pass stores its own `templateId` and the re-send looks the
      template up fresh; one deleted since is **reported and its people kept**, never dropped
      and never quietly sent something else.
    - ⚠ **The runner does not save the list itself, the button does.** A save inside would let
      the second pass overwrite the first, leaving only half the book sendable — asserted, and
      red-checked.
    - ⚠ **A retry replaces the list, it never merges.** Somebody who got through has to leave
      it, or the card asks her to keep emailing people who already have it — and a card that
      cries wolf is one she stops opening. An empty result clears it.
    - ⚠ **Both ways of counting a failure record a person.** A recipient with no email (nothing
      was ever sent) and a refused send both increment `failed`, so recording only one would let
      the card read "392 did not get it" over four names. The gate counts the two against each
      other; a red-check that renamed one of them went straight through the first version.
    - ⭐ **AND THE CAUSE WAS FOUND: GMAIL WAS REFUSING THEM FOR GOING TOO FAST** (2026-09-09,
      [[EM-02]]). The refusal, read off EmailJS: *"Gmail_API: User-rate limit exceeded. Retry
      after 2026-09-09T21:44:42.819Z (Mail sending)"*, against sends taking **0.603s each**. It
      was never the EmailJS quota — 1,025 requests were left. Gmail counts the **rate**, and
      this loop fired the next send the instant the last one returned: about 1.7 a second,
      sustained across the whole book.
      - ⚠ **Carrying on is what turned one refusal into 392.** Every send behind the limit was
        refused too, each spending an EmailJS request to be told the same thing — and the Not
        Paid pass ran afterwards and lost all 19, because the limit is on the **account**, not
        the template. That is the "0 of 19" the office saw.
      - ⭐ **AND IT IS EVERY SENDER NOW, NOT JUST THIS ONE** ([[EM-08]]). Addie: *"I just
        want it to make it so we never have this happen again."* It was true of **one
        sender out of five** — `sendBulkUpdateEmailBtn`, `sendRsvpEmailBtn`,
        `pibSendUnpaidBtn` and `pibSendPaidBtn` were still firing back to back, so the
        **invoice and receipt runs** would have hit the identical refusal on an identical
        loop. `emailSendPaced` carries the rule and a gate counts that all four call it; the
        wait budget is shared across the run rather than renewed per message.
        ⚠ **The RSVP runner keeps its own inline copy on purpose** — it was already
        shipped and working, and Addie's rule for this merge was *"make sure no code is
        changed unless we need the code changed."* The cost is two copies, guarded by a
        check that both read the SAME three constants (comments stripped, because each
        name also appears in the prose explaining it). Fold them together only if that
        runner is touched for its own reasons.
      - ⭐ **AND EVERY SENDER NAMES WHO IT FAILED FOR** ([[EM-09]]). Addie: *"it should
        also note whos email failed to send this is the biggest peice."* Four of the five
        reported a bare COUNT — including the **invoice and receipt** runs, so a customer
        whose bill never arrived was invisible and never chased. All five now record a
        row per failure, plus everybody left untried when Gmail stops the run.
        ⚠ Four of them are **listed but not re-sendable from the card** (`resend: false`):
        their body comes from a box on their own tab, so there is no saved template to
        re-render. The card names the tab instead — a button that silently does nothing
        is worse than one that says it cannot.
      - `EMAIL_SEND_GAP_MS` (1000) paces it; `emailSendRetryAfter` reads Gmail's refusal and
        **stops the run**, recording everybody untried so *Send again* resumes exactly where it
        stopped. One pass being stopped stops the other, and the passes behind it are recorded
        rather than dropped.
      - ⚠ **The gap is a floor, not a target.** A send already takes ~0.6s, so a 950-customer
        RSVP now takes ~25 minutes. That is the right trade: the season's RSVP is sent once, and
        a slow send that reaches everybody beats a fast one that reaches half. **Do not lower it
        to speed a send up** — the cost of being wrong is not a slow send, it is a customer who
        is never asked and whom `isOutForSeason` then drops from the season for not answering.
      - ⚠ **The retry time is what tells the two causes apart**, so it is shown in local time
        and in words (`sendStoppedNote`): minutes away is the rate limit and waiting works;
        hours away is the day's sending cap and the rest go tomorrow.
      - ⭐ **AND A SHORT REFUSAL IS WAITED OUT RATHER THAN HANDED BACK** (2026-09-09,
        [[EM-03]]). The second refusal named a time **minutes** away — the rate limit
        clearing — so the send now sits through it and carries on by itself rather than
        stopping and asking the office to press the button again. Bounded three ways, or
        the tab looks busy for ever: a wait under `EMAIL_MAX_AUTO_WAIT_MS` (15 min), at
        most `EMAIL_MAX_AUTO_WAITS` (6) in a run, and only when Gmail named a time.
        - ⚠ **The length ceiling is what keeps the two causes apart.** A rate limit clears
          in minutes; the day's cap clears at midnight Pacific and no wait inside one run
          fixes it, so a long one stops and the rest go tomorrow. The count ceiling is
          about being readable: a send throttled every few customers would run for hours
          looking healthy, and nobody watching can tell slow from stuck.
        - ⚠ **The retry wraps the send only, never the message build** — rebuilding asks
          `referralOfferFor` about one customer twice and double-counts them in
          `noReferral`. Asserted by COUNT: a check that only asked whether the first call
          sat outside the loop passed with a second one added inside.
      - ⚠ **Only a refusal about RATE halts the run.** An ordinary bounce or a bad address skips
        that one person and the send carries on — a parser that stopped on any failure would
        halt the season's RSVP over one bad address. `emailSendRetryAfter` is **run** against
        the real string above rather than matched, and the silent side is checked as carefully
        as the catch.
    - ⭐ **AND WHO HAS BEEN ASKED IS NOW WRITTEN DOWN PER CUSTOMER** (2026-09-09,
      [[EM-04]]). Addie: *"the people that have already got the email should not get it
      again"*, and *"We need to determine the fails I though that's what health check was
      for."* Neither was possible, because **nothing recorded who a send reached** — the
      office's own RSVP left no trace on the customer, so Firebase simply did not hold
      the fact and the refused customers could not be told apart from the reached ones.
      - `rsvpEmailedAt` is stamped on a successful RSVP send. **The mechanism already
        existed for the other send**: `arrearsRsvpEmailAt` has been stamped by the
        server's arrears chase since it was built, with her rule already in its comment
        ("ONCE PER CUSTOMER PER SEASON, EVER") and Start New Season clearing it. This is
        that, applied to the send the office actually presses.
      - `rsvpWholePlan` skips **either** stamp and counts them as *Already emailed this
        season*. Reading only one re-asks everybody the automation already reached.
      - ⚠ **Only an RSVP is stamped.** An invoice or a receipt is not the season's
        question, and stamping one makes somebody look asked when nobody asked them.
      - ⚠ **A failed stamp never fails the send.** The email has gone; the worst a lost
        stamp does is offer a duplicate later, which is the safe direction — the opposite
        mistake is a customer never asked at all.
      - Health Check row **The RSVP never reached these customers**. ⚠ **It is SILENT
        until at least one send has been recorded** ([[EM-07]]) — with no stamp on
        anybody, "never reached" is not a finding about customers, it is the app having
        no data, and the row would list the whole book on an evening the RSVP had gone
        out fine. It shipped without that guard and Addie's question is what found it.
        Either stamp counts as a record. ⚠ It reverses HC-03,
        which said not to add a row because she did not open the panel — that complaint
        was fixed the day after, when approve/deny shipped, and she has now asked for
        this by name (R-024). ⚠ It is a **different question** from `seasonRuleDrops`:
        that lists people who were ASKED and said nothing, their decision; this lists
        people who were NEVER ASKED, our failure.
    - ⭐ **HOW THE MISSED ONES ACTUALLY GOT THEIR EMAIL** ([[EM-05]]): from **EmailJS's
      own error emails**, which carry a resend button. Addie: *"they have resend buttons
      in every error email it says there was 401 error email's I can resend those
      tomorrow."* EmailJS holds the authoritative per-message record of what was refused;
      this app holds none for that run. Re-sending there reaches exactly the 401 and
      nobody else — a second whole-RSVP press would have mailed everybody who DID get it
      a second time.
      - ⚠ **A guess at the boundary was considered and dropped.** "Nobody after Laura
        Checketts got one" was offered and then withdrawn, and nothing was built on it:
        marking the wrong people as already-asked means a customer who is never asked,
        whom `isOutForSeason` then drops from the season.
      - ⚠ **A resend from EmailJS is invisible to this app.** It never passes through
        admin.html, so no stamp is written and those customers keep appearing in
        `rsvpNeverReached`. The row's own note says so.
      - ⭐ **AND SHE CAN TELL THE APP IT IS DONE** ([[EM-06]]). *"So if we resend tomorrow
        will it move passed people who have already been sent email?"* — the two routes
        answer that differently, and that is the thing to be clear about. **EmailJS's
        resend touches only the messages that failed**, because a successful send raised
        no error email, so it cannot reach anybody who already got it. **The app's own
        Send the whole RSVP would mail the whole book again**, because nobody from that
        run carries `rsvpEmailedAt` — the stamp did not exist when it ran.
        `rsvpMarkAllAsked` closes the gap: it stamps everybody the planner would have
        written to, so the app stops offering to ask them again and the row goes quiet.
        ⚠ It marks the **planner's** list, never the whole book, and takes a dry run then
        a typed word — a customer wrongly marked as asked is never asked again this
        season, while a missing stamp only ever costs a duplicate.
      - ⭐ **AND ONE PERSON AT A TIME, WHICH IS HOW THE JOB ACTUALLY ARRIVES** ([[EM-10]],
        2026-09-10). Asked what she can get out of EmailJS for those resends, Addie's
        answer was **individual error emails only** — no list anywhere. That rules out
        both of the things that existed: a paste box has nothing to paste, and
        `rsvpMarkAllAsked` is *wrong* when only SOME have been emailed, because it stamps
        the whole planner list. **Mark one person as asked**, on the same card, is the
        per-person half: a search box, and a tick beside each customer still waiting.
        - **Search by the address, not just the name.** An error email names ONE address;
          the name in it is ours and may be spelled any number of ways, the address is
          the customer's own. Matching either, ignoring case.
        - ⚠ **The Undo is the safety here, not a typed word.** The bulk button writes ~950
          records and earns its `ASKED` prompt; this writes one record she is looking at,
          so a visible Undo beats a confirm she would clear hundreds of times and stop
          reading. Undo writes `null`, the same spelling Start New Season uses.
        - ⚠ **A row marked in this session stays on screen, greyed.** The stamp moves that
          customer out of `plan.standard` the instant it lands, so a plain redraw would
          drop the row and take the Undo with it one frame after the press — the MSG-15
          trap. They stay until the page is reloaded.
        - ⚠ **It reads `rsvpWholePlan`, never `jobAddresses`.** A second definition of
          "waiting to be asked" is how this list and the Ordinary RSVP count above it
          start disagreeing about the same customers.
        - `rsvp-mark-one.test.js` runs all of it against a fake DOM and Firestore rather
          than matching source; 12 sabotages red-checked, including one the first draft
          MISSED — a text check for the refresh call survived the guard around it being
          changed to `if(false)`, so it is a spy on the real renderer now.
      - ⭐ **AND A WHOLE PASTED LIST, BECAUSE SHE IS KEEPING ONE** ([[EM-11]], 2026-09-10).
        Addie: *"Can you check whos not ticked off in the admin portal for RSVP?"* — and under
        it her own send log, ~900 lines of `Name,Sent,Times sent,Ticked off in app?` with that
        last column empty. **Check a whole list you sent outside this app**, on the same card,
        is what fills it. Paste it, press **Check this list**, and every pasted name is sorted
        into a bucket: already recorded as asked, already answered, **not recorded**, no email
        on file, do-not-send, new this year, or could-not-be-matched.
        ⚠ **This revises EM-10's "a paste box has nothing to paste" on its PREMISE, not its
        logic.** EmailJS still hands her no list; she turned out to be keeping one herself,
        outside it. A paste box is useless only while there is nothing to put in it.
        - **It reports. It never bulk-writes.** Each not-ticked row carries the SAME
          `rsvpMarkOneAsked` button as the list above, with the same Undo. One press that
          stamped every pasted name would be the bulk button's all-or-nothing mistake wearing
          a list, with no typed word in front of it.
        - **Names are keyed the way `dupNormName` keys them — words sorted** — so the sheet's
          "Meier Larna" and the app's "Larna Meier" are one person, which is her own rule that
          two names match only when one of them is surname-first. An apostrophe does not split
          a name; a typo is not a match.
        - ⚠ **A name held by two customers resolves to NEITHER, and is named.** Six names in
          the real book belong to two rows; ticking the wrong one is worse than ticking neither,
          because the one named is then believed and the other is never chased.
        - ⚠ **Every bucket that needs a human is listed by name; the two that do not are
          counted.** On her real log ~900 rows carry no action, and burying the handful that
          matter underneath them is the cries-wolf failure in a new place. The not-ticked names
          are also offered back as pasteable text, because the question was a spreadsheet column.
        - ⚠ **`rsvpWholePlan` gained `answeredList` and `newThisYearList` beside its two
          counts.** They were counts ONLY, so a pasted name in either was indistinguishable from
          a name the plan had never seen — and somebody who had already REPLIED would have been
          reported as still needing a tick. The counts and the lists are asserted equal, because
          they are written a line apart.
        - The comparison re-runs no predicate of its own: it asks which of the plan's own lists
          holds that customer, filed in the plan's order, first bucket wins. 13 further sabotages
          red-checked; the only one not caught by the check written for it was caught by three
          siblings.
        - ⭐ **And one button ticks the whole not-ticked list** ([[EM-12]], 2026-09-10). Addie:
          *"will this tick all the people that are not ticked?"* — and what it is for:
          *"so I can send out emails to people that need there email sent out through the send
          button you created to all the people who aren't ticked."*
          ⭐ **So the tick is the NARROWING and Send the whole RSVP is the send.** That button
          already skips anybody carrying `rsvpEmailedAt`, so ticking the people her log says
          were emailed is precisely what leaves it aimed at the ones who still need it.
          ⛔ **No second sender was built on this report, and none should be** — one job, one
          sender. The narrowing was the only part missing.
          - ⚠ **Her own pasted names, and only the NOT-recorded bucket of them.** *"Should only
            tick people I added above."* Each excluded bucket is a different way to write down
            something untrue about a real person: no email on file (we hold no address),
            do-not-send (we are forbidden to write to them), new this year (an RSVP we never
            send), an ambiguous name (whichever twin came back first).
          - ⚠ **The same lock as the all-or-nothing button** — a confirm naming the count and
            what it leaves alone, then `ASKED` typed out. It is SAFER than that button rather
            than merely equal, because that one stamps the planner's whole list sight unseen
            while this one can only stamp names she supplied and can see above the button.
          - ⚠ **The waiting list is drawn in FULL, uncapped**, so the number on the button is
            the number of rows she is looking at. Capping it would tick names she never saw —
            the sheet ledger's own shipped bug. The informational buckets stay capped.
          - ⭐ **Its own gate caught a real bug**: the result line was written before the redraw,
            and the redraw writes its own count into that same line — so the press read
            identically whether it saved three hundred records or none, a refused batch
            included. Redraw first, result last. 11 sabotages red-checked.
          - ⭐ **A Tick-all can be taken back** ([[EM-14]], 2026-09-10). `rsvpMarkOneRecent` — the Undo
            behind the one-at-a-time button — is only ever added to by that button, so a bulk tick had
            **no undo anywhere**: those customers left every waiting list at once and the way back was
            editing records one by one. **Undo that — put those N back** appears after a tick.
            - ⚠ **No typed word on the way back**, deliberately: ticking wrongly loses a house a crew
              never visits, un-ticking wrongly costs one duplicate email. The lock belongs on the
              dangerous direction only.
            - ⚠ **It holds the ids the server took**, not the ones it set out with — a refused batch
              left them unticked, and un-ticking those would write null over another send's stamp.
            - ⚠ **A refused undo keeps what it was undoing**, so it can be pressed again. Session-only,
              and the button says so.
          - ⭐ **An ambiguous name names both customers** ([[EM-14]]). Five on the real book match two
            customers each; the row said *matches 2 customers — not resolved* and gave her nothing to
            act on, the search box being no help when both share the name. It now shows both with the
            address and email that separate them. **Naming both is not picking one** — the refusal to
            resolve is unchanged and still asserted.
          - ⭐ **And the report redraws itself when customer data changes** ([[EM-13]], 2026-09-10).
            Addie ticked 495 off, the result line said *Ticked off 495 of 495*, and the list beneath
            still read 495 NOT ticked — so it looked like a failed write. It was not: a second press
            of **Check this list** showed 495 recorded, 170 already answered, **0 not ticked**.
            ⚠ **`jobAddresses` is rebuilt wholesale by its listener**, so the tick's optimistic
            mirror is thrown away, and `rsvpWholeRenderBreakdown` — the only thing that redraws this
            report — is wired to buttons, not to customer data. The screen could sit stale with
            nothing to tell it from a refused write.
            - **Quiet**, so it corrects the list under her but never the line saying what the last
              press did. A person pressing a button still gets the count.
            - **Never blanks a report she is reading**: an unready plan changes nothing rather than
              clearing the box on a transient, since an empty report reads as "found nothing".
            - Mapped to the automation panel, so it draws only while that tab is open.
            7 sabotages red-checked — one of which caught the fixture for the blanking rule being
            vacuous, because a report built unready is already empty and cannot show being cleared.
        - ⭐ **THE WHOLE RSVP, 200 A MORNING, SENT BY THE SERVER** ([[EM-16]], 2026-09-10).
          Addie: *"we need to make sure we don't run into this situation in the future. Can we
          make a calendar for RSVP emails that will only send 200 emails a day until we send them
          all out?"* The situation was a send of ~950 that Gmail cut off partway, which then took
          a pasted spreadsheet of 673 names to reconcile. **Automation Emails → Send the RSVP a
          few hundred a day**: Build the plan, then a 9 AM Cloud Function works down it.
          - ⭐ **THE BROWSER DECIDES, THE SERVER SENDS.** `rsvpSendSkipReason` ([[EM-15]]) and the
            paid/unpaid split rest on six rules that live only in admin.html —
            `audienceNeverAsked`, `audienceQuoteJoinYear`, `isRequote`, `enrollmentYearOf`,
            `effectiveRsvpStatus`, `houseOwesFromLastSeason` — three needing `quotesCache` and one
            needing every invoice. So the queue is decided once, written to
            `settings/rsvpSendPlan` carrying a template per person, and `runRsvpDailyBatch` is a
            pipe that sends the names it was handed. ⚠ **Copying those rules onto the server**
            would put six new drift surfaces on the one send that has to reach everybody exactly
            once, and the server's copy is always the one nobody looks at.
          - ⭐ **IT IS ATTACHED TO HER OWN TWO TEMPLATES, BY ID.** Her follow-up: *"Can you make
            sure it is attached to the RSVP automation emails I created and will send out both
            depending on who paid and who did not pay?"* The first version looked them up by the
            exact names "RSVP Email" and "Not Paid RSVP" — a second opinion, because
            `rsvpWholeTemplates` finds an RSVP template by its CONTENT (any `{{rsvp_*}}` token) or
            its folder and tolerates the ordinary one being renamed. A renamed template was found
            on the screen and not on the server: the card would show a plan of several hundred and
            the 9 AM run would refuse every morning, in silence. The ids are resolved on the screen
            that can NAME the two it picked, and the card names them with a count each.
          - ⚠ **9 AM, NOT 10.** The unpaid chase and the quote nudges are both on 10:00, and three
            batches on one Gmail account is the limit this exists to stay under.
          - ⚠ **NOT A BROWSER TIMER.** A drip that stalls because nobody opened a tab is a season
            where half the book is never asked — the same failure wearing a calendar.
          - ⚠ **NOTHING RECORDS WHO IS DONE.** `rsvpEmailedAt` on the customer is the one record,
            so a queue walked past stamped names costs nothing and one plan serves all season.
          - ⚠ **THE CAP IS COUNTED IN SENDS, NEVER IN ROWS WALKED.** Counting rows makes a plan
            whose first 200 names are stamped send nothing on day two and report 0 — which reads
            as everybody having been asked.
          - ⚠ **A REFUSAL STOPS THE RUN** rather than burning 199 more attempts on an
            account-wide limit, and stamps nobody, so tomorrow carries on from there.
          - ⚠ **A PLAN FROM ANOTHER SEASON IS REFUSED.** Start New Season clears every stamp, so a
            leftover plan would re-send last year's RSVP on last year's paid/unpaid split.
          - ⚠ **THE STALE-PLAN COST IS SHOWN, NOT HIDDEN.** A customer added after the plan was
            built is not on it, so the card counts and NAMES them and offers the rebuild. Nothing
            rebuilds itself: a plan that silently reorders between two mornings cannot be checked
            against what she saw yesterday.
          - ⚠ **THE PRIVATE KEY IS THE ONE THING THAT CAN MAKE ALL OF IT SILENTLY DO NOTHING.** The
            browser sends with the public key, so **Send the whole RSVP** can work perfectly while
            the 9 AM run cannot send a single email. The card checks for it and says so in red.
          - ⭐ **IT CLOSED A DOUBLE-SEND HOLE ON THE WAY PAST.** `runArrearsRsvpBatch` skipped
            `arrearsRsvpEmailAt` alone, so anybody the office's own send had already asked would get
            the Not Paid email on top — the harassment that block's own header warns about, from the
            one direction it was not guarding. It reads both stamps now, as `rsvpWholePlan` always has.
          - ⚠ **AND THE RENDERER IS SHARED, NOT COPIED.** The RSVP body builder moved out of the
            unpaid chase into `rsvpEmailBodyServer` so the drip would not be a third copy — the
            `{{photo}}` and `{{link}}` pairings in this repo are both about two renderers drifting.
          - ⚠ **THE OFFICE'S OWN BUTTON WARNS BUT NEVER REFUSES** (`rsvpWholeSendWarning`). A guard
            that blocks a legitimate send has no way round it at all. It is its own function because
            the check for it was weak: a red-check proved `/total > RSVP_DRIP_DEFAULT_PER_DAY/` stays
            green with `false &&` in front of it.
          - ⭐ **IT HAS A TAB OF ITS OWN, NAMED RSVP.** Addie: *"Make a new tab in automation
            email for RSVP for this send 200 for each day"*, then *"put it in it's own tab on
            Automation Email named RSVP"*. It started as a card under **Templates**, which is
            where the RSVP send already lived — but a card at the bottom of the tab somebody
            opens to EDIT an email is not where anybody looks to find out whether today's batch
            went out, and "how many are left" is asked on days when no template is touched.
            ⚠ **Send the whole RSVP stays on Templates**: it is one press beside the templates
            it sends, and moving it would break the one route the office already knows.
            ⚠ **The tab draws on open**, the way the Invoices tab does — `rsvpDrip` is a
            deferred render and `flushPendingRenders` fires on the PANEL opening, so switching
            tabs inside an already-open Automation Emails would otherwise show nothing.
          - ⚠ **AND WITH NO PLAN IT NAMES ONLY ONE NEXT STEP.** The card used to read *"Nothing
            is sent until you switch it on or press Send today's batch now"* — and both of those
            are REFUSED until a plan exists (the button answers "There is no plan to send", the
            switch refuses to arm). So the one sentence saying what to do next named two presses
            that cannot work. It names **Build the plan** alone. That is this repo's "a message
            that is on screen and cannot be true" failure, which it has paid for at least three
            times, so the no-plan branch is asserted rather than only corrected.
          - ⭐ **WHICH BUTTON IS GOLD MOVES WITH THE NEXT STEP** (`rsvpDripSetButtons`). Addie
            asked twice for *"a button that lets us send 200 emails a day"* when both the button
            and the schedule were already there — which says the card was not making either
            obvious, not that they were missing. Before a plan exists **Build the plan** is
            gold; once one does, **Send today's 200 now** is, and it NAMES the cap rather than
            the queue. ⚠ This is the measure tool's own lesson (MR: two commit buttons, one
            gold, and the gold one is the one that got pressed, so houses ended up priced with
            no footage). ⚠ **Exactly one is gold after every transition, in both directions** —
            a class added and never removed leaves both gold, and the red-check proved a
            spot-check in one order cannot see it.
          `rsvp-daily-send.test.js`, 137 checks, 57 sabotages red-checked across two passes.
          Four of its own checks were caught being weak by those passes, and one sabotage was a
          no-op that retired a dead guard.
    - Each row carries its own reason rather than the run's last one, so the next occurrence
      names itself. 10 sabotages red-checked across the two passes.
  - ⚠ **The `{{quote_` prefix inside it is built with `String.fromCharCode(123,123)`.** Suites
    lift a function by counting braces from its signature, so two unbalanced opening braces in
    a string run the count off the end and the whole function reads as **missing** — the suite
    then skips or passes vacuously rather than failing. Inside the old click handler nothing
    lifted it by name, so it never mattered; as a named function it does. Same reasoning as the
    `$$` column being built with `String.fromCharCode`.
  - ⚠ **Suite 128's do-not-send checks were repointed, not weakened.** They asserted the gate
    sat inside the *listener*, which is where it happened to live rather than what must be
    true. They now assert it is in the thing that actually mails, that the slice was found at
    all (so they cannot pass vacuously against an empty string), and that the handler reaches
    the sender instead of calling `emailjs.send` itself — a second loop growing back inside
    the handler is the two-senders failure rebuilt one level down.
- **Filter, then select everyone under the filter** (Automation Emails → Preview & Send, rebuilt 2026-09-04). Dax: *"in automated emails make it so you can filter who you see then you can select all so it selects everyone under the filter you chose."* Both halves of that sentence already existed and the send still reached the wrong people, for two separate reasons.
  - **There were two send screens, and the obvious button opened the worse one.** Every template card carries a green **Send**; it used to open a *Send Template* modal with a search box and nothing else — no audience filters, no Select All, no preview, no quote tokens or photos, and no record that an RSVP had gone out. The good screen was behind a small outline **Preview & Send** button at the top of the tab, which nobody presses when there is a Send on the card itself. The card now opens Preview & Send with that template already chosen, and the second modal is **deleted** rather than left as a door somebody could still walk through: two senders over one book is a set of rules that holds or does not depending on which button was pressed, and nobody would ever find out which.
  - **Select All was losing ticks in silence.** The recipient list is rebuilt by `innerHTML` on every keystroke, and the ticks lived only in the checkboxes — so filtering to 312 unpaid customers, pressing Select All, then typing one name into the search box to check it left exactly **one** tick standing. The send went to one person while the count line still said 312, which looks exactly like a send that worked. The selection is held in `etSelectedRecipientIds` now and survives every repaint.
  - ⭐ **A filter drops whoever it excludes; the search box drops nobody.** That asymmetry is the design and it is not a nicety. Choosing an RSVP template quietly sets *New vs returning* to Returning precisely so Select All cannot reach a first-year customer, and a selection that outlived a filter change would carry them straight past that guard. So on every render the selection is pruned to the audience — **after** the do-not-send list and **after** the no-email split, so somebody added to that list loses their tick the moment the list redraws rather than depending on the send loop's last gate. The search box only decides what is *drawn*.
  - **The number on the button is the number that sends.** The *N selected* pill, the **Send to N selected** button, the confirm dialog and the send loop all read the same set, so they cannot drift. Select All names its own scope (*Select all 312 shown*), Clear selection empties the whole selection rather than only the visible rows, and **Clear filters** puts every filter — and the search box — back through the same reset the panel opens with, so the do-not-send line can never be forgotten in a second copy.
  - **The count line says when a search is hiding people**: *"312 members match these filters. — Showing 1 of them while you search. Everyone you have ticked stays ticked."* A shorter list with an unchanged tick count is exactly where somebody assumes the ticks went with it. A search matching nobody says how many still match the filters and how many are still ticked, instead of the old *"no members match this search and these filters"*, which read as the filters having come up empty.
  - Ruling [[RS-52]]. Suite 307 of `run-all.js` **runs** the renderer — whether a tick survives a repaint is state, not source — and Suite 128 §4 asserts the deleted sender cannot come back and that the template card really does route to the surviving one. 10 sabotages red-checked.
  - ⚠ **AND THE TWO "LAST YEAR" FILTERS WERE ASKING THE WRONG SOURCE ENTIRELY** (fixed 2026-09-05). Dax: *"when i push paid last year or didnt pay last year is shows no members match these filters which is not true… everyone paid last year other than the like 20 people we marked as not paid last year."* He was right.
    - ⛔ **THE SOURCE COULD ONLY EVER SPEAK AFTER A SEASON RESET.** `audiencePaidLastYear` and `audienceOrderedLastYear` read a `yearlySnapshots` document's `invoices` array — and the **only** thing that writes that array is **Start New Season**. Every other document in that collection is the finance snapshot (`computeYearTotals`: revenue, expenses, ccSpending, debt, netWorth, and no invoices at all), which `lastSeasonSnapshotFrom` correctly refuses. So before a reset there is no snapshot with rows, both filters answer `null` for **everybody**, and the audience is empty — with a book full of customers who plainly did pay.
    - ⭐ **THE ANSWER ALREADY EXISTED AND THE REST OF THE APP WAS ALREADY USING IT.** `houseOwesFromLastSeason` reads the carried arrears off the **live** invoice — the same rule behind Schedule → *Owes from last year*, the portal's season hold and `arrearsOutstanding`, and the thing the office actually marks. Reading a snapshot here was a SECOND answer to a question this app had already settled, and it was the quieter one. Same shape as `payerHouseOf` and `houseIsOnTheBill`: one rule, every caller asks it. **Unpaid = owes from last season. Paid = a returning customer who does not.**
    - ⚠ **THE LIVE ONE ON PURPOSE.** A snapshot is frozen at reset; the arrears moves when somebody pays. A chase-the-unpaid send built off a snapshot goes on naming people who have since settled, which is worse than not sending it.
    - ⚠ **A FIRST-YEAR CUSTOMER IS `null`, NEVER "paid".** They were not billed last season, so "they paid" is a claim nobody can make — and `null` keeps them out of **both** filters rather than quietly padding the paid audience with people who were not there. `audienceNeverAsked` is the same union the RSVP send uses; the $30 fee box alone is narrower than it looks.
    - ⚠ **AND "NOT LOADED YET" IS NOT "PAID".** `houseOwesFromLastSeason` answers false on an empty `invoiceById`, which alone reads as everybody having paid — for the second after login, on the filter that decides who gets chased for money. The load is checked first, and both filters say they cannot answer instead.
    - ⭐ **The message named the wrong cause, which was worse than saying nothing.** It read *"no saved snapshot from last season yet … until Start New Season saves one"* — telling the office to run an **irreversible whole-book reset** to fix a filter. It now says the invoices are still loading, which is the only reason left and fixes itself. A check exists whose only job is to fail if `Start New Season` is ever named there again.
    - Suite 307 §8–9 of `run-all.js` RUNS the filter against fixtures — every claim here is about what a lookup resolves to for one customer, and the old version was green under source checks the whole time it was answering `null` for the entire book. 6 sabotages red-checked.
- **Every email carries a subject line** (added 2026-08-31). Addie: *"I need a subject on all them... we just need them to know it a christmas light RSVP."* Sixteen of the twenty `emailjs.send` calls in `admin.html` passed **no subject at all** — twelve of those are dead UI (`quickEmail*`, `bulkAuto*`, `rsvpInclude*`, `pib*`, every id in `KNOWN_MISSING_IDS`), and the four live ones now carry one, as do both server sends in `functions/index.js`. Only the quote emails ever had one, which is why quotes look right in an inbox and the RSVP did not.
  - **Each template has its own Subject box** (Automation Emails → Templates). Blank falls back to a standard subject chosen by what the template *is*: an RSVP gets *"Your Christmas lights this year — a quick yes or no"*, a billing template gets *"Your Highlighting Utah invoice"*, a quote gets *"Your Highlighting Utah quote"*. The fallback is what makes this work today — no template saved before 2026-08-31 has the field.
  - ⚠ **The EmailJS template's own Subject field must say `{{subject}}`.** One EmailJS template serves every send in this app (they all read `#emailjsTemplateId`), so the subject cannot be set per-email over there — it has to travel with each send. If that box holds fixed text instead, none of this reaches anybody.
  - ⚠ **A receipt must never inherit the RSVP subject.** "A quick yes or no" on top of a bill is worse than a blank subject, which is why the fallback is chosen by kind rather than shared. `email-subject.test.js` runs the builders and asserts the *requirement* — that an RSVP subject names Christmas lights and reads as a question — rather than the exact sentence, so rewording it is not a failing build.

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

⚠ **A step that is not built says so, and looks different.** ⭐ **Both payment chases are now
built (2026-09-11) and the dates moved with the terms** — a text the office sends on **1
February**, and an automatic email on **1 April** carrying the fee and the updated bill. The
fee rule is the one that was already written down in the page, unchanged: **$25 if they have
paid something, $40 if they have paid nothing**. ⚠ **The April send is the only thing in the
app that charges a customer with nobody pressing anything, and it ships switched OFF** —
`settings/lateFeeAutomation`, with a *Check first* dry run beside the switch in Invoices >
Nightly Automation. Drawn as working while it is off, this page would be a wish rather than a
map, and its whole value is that it is true.

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

⭐ **AND THE ROW NOW CHECKS THAT THE DAY IS REAL** (2026-09-11, [[SCH-73]]). Addie, on
Darlene Price #680: *"It says shes scheduled for Oct 16 but I dont see oct 16 on the
schedule."* The green pill in **All Customers › Route** read those stamps and nothing
else, so a booking that had since been taken apart went on promising a van. It asks
`scheduledDayIsReal` now — is there a crew route on that date, and does it hold this
house? — and when the answer is a flat no the pill turns red and says **"not on the
schedule"**.

⚠ **NOTHING WAS EVER GOING TO FIND THAT ON ITS OWN, which is the part worth knowing.**
The two sweeps between them cover the other cases and not this one: `clearStaleInstallBookings`
only clears a stamp for somebody who is OUT for the season (Darlene is Confirmed), and the
reconcile sweep's stranded pass only re-homes a date already in the PAST. Step 1 of that
sweep walks **routes** and corrects the records on them, so a customer on no route is never
looked at.

⛔ **THE PILL REPORTS; THE REPAIR HAPPENS ON RECALCULATE EVERYTHING** (2026-09-11, [[SCH-74]]).
Addie: *"I can't check every day to look at which date everyone was assigned and if it's
legitamite or not I need it to correctly place them."* She is right — a warning on one row
out of ~950 is a report. `clearStaleInstallBookingsRun` now clears an orphaned stamp as well
as an out-for-the-season one, so the next sweep re-homes them and the date comes right on its
own. The pill stays as the thing that says so on screen; it still never writes.

⭐ **AND THE CAUSE IS THAT THERE ARE TWO PLANNERS.** The **Schedule** tab builds
`routeSchedule` — the day list, Recalculate everything, both crew print sheets, the Printing
tab. The **reconcile sweep** builds its own crew-days in `scheduledRoutes` every fifteen
minutes, and that is what stamps `scheduled` / `scheduledDate` / `assignedCrew` on the
customer. The row was reporting the planner the office does not look at.

⭐ **THE SWEEP NOW PLANS BY THE WEATHER TOO.** `rebuildSeasonDays` has always passed the cold
veto, the chilly preference and the warmth band; the sweep passed `maxDays` alone, so its
forecast lookup defaulted to "no opinion" and the cold rule **could never fire there** — it
would send a crew to a town at 20° and write that date onto a row. Both now pass the same
four options. ⚠ It is still a TEMPERATURE rule only: 38° and snowing passes it, and frost on
one roof is a morning call no forecast can make.
⚠ And it answers **three** ways, not two: until `scheduledRoutesLoaded` is set every stamped
customer looks orphaned, so before that it says "cannot tell" and the pill is exactly what
it was before.

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

### Maybe Next Year from a quote email builds the record that answer lives on

Added 2026-09-04 ([[QT-23]]). Addie: *"when they click maybe next year nothing happens
because we dont have their customer data but we want them to be in the exact same
situation as a maybe next year off of the rsvp."*

**Where Maybe Next Year is actually recorded is the customer.** Two fields on
`jobAddresses` — `maybeNextYear` and `rsvpStatus: 'backnextyear'` — and every screen that
shows the group reads them: the All Customers season badge and its filter, the Contact
2027 sheet, the RSVP audience picker, `isOutForSeason`. So the answer only exists if a
customer record does.

**A lead answering from a quote email has none.** `quoteRespond` set `approvalStatus` on
the QUOTE and stopped. The card slid into Closed, and the person who took the trouble to
answer appeared on none of those lists — so next August nobody knows they asked to be
asked again, which is the one thing they told us. Nothing anywhere was red about it.

Now the answer creates the record, through `quoteLeadCustomerFields` and
`createNextYearCustomerFromQuote`. From then on they ARE any other Maybe Next Year: same
badge, same filter, same sheet, same audience, and the office's Confirmed toggle brings
them back in one click when the season comes round.

⚠ **IT IS A LEAD SITTING OUT, NOT A CONVERSION, and every field turns on that.** Convert
to Customer takes a number out of the pool, opens an invoice, queues the warehouse, starts
the 48-hour lights window and puts them on a day. None of that may happen to somebody
whose answer was "not this year" — it would bill a person who bought nothing and build a
set nobody is hanging. What is written is their details plus the season pair: no
`customerNumber`, no invoice, no `needsLightBuild`, no `lightsLockedUntil`, no
`needsDayAssignedAt`, no `chargeNewMemberFee`. The price and the footage they were quoted
DO travel, so next August starts from a number rather than a re-measure.

⚠ **AND ONLY ON A QUOTE THE OFFICE HAS PRICED.** `firestore.rules` stops a public create
from setting `quotedPrice`, so a price is proof staff touched this quote and sent it.
Without that gate anyone who can submit the public quote form could type a stranger's
address, press Maybe Next Year and put a row into the customer book — and
`quoteCustomerRef` carries the same gate, so it would not even have looked for an existing
customer first, which means a real member could be duplicated too. A quote EMAIL only goes
out after pricing, so the gate costs the real case nothing. `quoteLeadNeedsRecord` also
refuses a quote that already points at a customer (there, `quoteCustomerRef` returning
null means that customer was DELETED — an answer, not a gap), and one with no address or
no contact of any kind, because neither can ever be matched again.

⚠ **THE QUOTE LINK IS `nextYearCustomerId`, DELIBERATELY NOT `existingCustomerId`.**
Either of the membership fields would make the approve path call this lead a MEMBER, so if
they changed their mind and approved they would be shown "anything changing this year?"
prefilled from a record holding no colours, and would never be asked for their install
details at all. It doubles as the idempotency key: the emailed link stays live in an inbox
for months and the button gets tapped twice.

⚠ **THIS IS THE OPPOSITE ANSWER TO A DECLINE, and that is not an inconsistency.**
`declineAsksAboutLastYear` deliberately touches no new lead (*"we won't have an info for
them yet"*) — somebody who said no is not asking to be contacted. Maybe Next Year is a
request to be asked again, and the record is what carries it.

⚠ **The record has no map pin and says so** (`needsGeocode`, `lat: null`). There is no
geocoder on the server; an invented lat/lng is worse than none, and it costs nothing this
season because somebody sitting out is never routed. Opening them and pressing Save runs
the lookup. A System note goes to the Inbox as well — this is the only path that creates a
customer with nobody pressing a button, and a numberless row simply materialising in All
Customers reads as a bug.

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

### A card payment that found no bill now shows up

Addie, asked where these should go: *"Put that in health check."*

⚠ **The money was invisible.** `recordUnmatchedPayment` files a capture that succeeded with
no invoice to apply it to — usually because the phone or email the bill is keyed on changed
after it was written. **No screen in the app read that collection**, nothing ever wrote
`resolved: true`, and `firestore.rules` forbids writing to it. Real money, correctly
captured, in a place with no way in and no way out — while the customer's own portal reads
**Paid in Full**.

⚠ **The Invoices tab was argued for and she chose Health Check.** The objection was HC-03 —
she had said she does not read that panel because nothing could be marked done — and it is
largely spent: approve/deny shipped on 2026-08-27, so a row can be cleared now. Her answer
stands, and it was put to her first.

⚠ **No fix button.** Applying it to the right invoice, refunding it, or marking it seen are
three different answers about somebody's money, and Q-025 settled only **where** it shows.

**And she hears about it before the bill goes out.** Addie, 2026-08-30: *"we need unmatched
invoice to come up in system inbox before we send it out."* Offered the choice between holding
the invoice back and flagging it, she chose **note it and warn on the invoice screen**.

- `recordUnmatchedPayment` now posts a **System inbox note** at the moment the capture is
  filed, deduped on the capture id so one payment cannot raise a note every time anything
  re-reads it. ⚠ It **cannot throw**: it runs after the money has already been taken, so a
  failed note must never unwind a successful capture.
- `renderUnmatchedPaymentBanner` puts a warning at the top of the **Invoices tab**, naming the
  customers the payment might belong to (matched on phone digits).

⚠ **The bill is NOT held back.** That was the other option and it was turned down for a good
reason: a payment we cannot match is *our* bookkeeping problem, and stopping somebody's
invoice over it means they are not billed at all — a worse outcome for a customer who has
done nothing wrong.

⚠ **The banner says the money is safe.** "Unmatched payment" reads as money lost; it is a
payment that arrived and could not be filed, so the wording says so in those words.

⚠ **And "Not a problem" is how one is cleared, which needs no rules deploy.** The decision
is written to `healthCheckDecisions`, never to `unmatchedPayments`, so that collection stays
write-forbidden exactly as it is — asserted, because a write from the browser would fail
silently. The decision fingerprint lapses if the amount changes, so a second payment on the
same key comes back rather than hiding behind an old decision.

⚠ **A failed read reports nothing, not an all-clear.** `hcUnmatched` is null until it loads
and stays null if the read fails; `(hcUnmatched || [])` is what makes that a silence rather
than a confident *"no stranded money"* on the one screen that must never give a false one.

### A customer with no email is billed anyway — the bill just gets sent by hand

Addie, 2026-08-30: *"How invoice bills. So if no email on file than invoice by phone for
member portal. I'll send invoices that only have phone number on file myself."*

⚠ **They were not getting an invoice at all — not merely not getting an email.** The
nightly run gave up on a payer with no email address *before* the invoice document was
written, so there was nothing in their member portal to look at, no record anywhere of what
was owed, and the work stayed unbilled. Their portal is reached with a **phone** and a last
name, so the bill being there is the whole point.

⚠ **The fix is an ordering, and that is all it is.** The no-email block moved **down**, past
the invoice write and past the carryover handling, to sit immediately before the email send.
Everything that raises the bill now runs first; only the sending is skipped.

⚠ **It had to go below the carryover drawdown**, which is why it landed exactly there.
Both the carried-charge clearing and the credit drawdown are written straight after the
invoice so the two documents agree even if what follows fails — bailing out above them
would leave the invoice holding a credit the customer still has in full, and the next run
would apply it a second time.

⚠ **`invoiceEmailSent` is deliberately NOT set.** It means the bill has gone out, and it has
not — so they stay on tomorrow night's list and in the nightly summary until somebody deals
with them, which is what *"I'll send those myself"* needs. Re-running is safe: the join fee
is guarded by `newMemberFeeApplied`, the carried charge was cleared off each house, the
credit was drawn off the payer, and the Inbox note only posts once.

⚠ **Three pieces of wording went untrue with the behaviour and all three moved.** The
nightly text said *"NO EMAIL (cannot be billed)"*; the Inbox note said they *"have not been
charged for work already done"*; a check in `run-all.js` pinned the first of those
literally. They are billed now — describing that as impossible is the one thing that would
stop her doing the part that is hers. The **"Cannot Be Billed" filter name** in All
Customers is deliberately left alone: it is an identifier the office reads, not stale copy.

⚠ **And the check that pinned the copy was repointed, not weakened** — same slow-fuse shape
as S82 and S129: pinned to where a string sat rather than to what must be true, so it failed
on correct code the moment the copy had to change. What must be true is that the alert
**names** them.

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

### A payment that finds no bill — half closed

⚠ **THIS SECTION USED TO BE HEADED "an open hole" AND SAID NO SCREEN READ THE COLLECTION.
That stopped being true on 2026-08-30.** The original text is kept below the line because it
is the argument for why the remaining half is still open.

When a card is captured and the invoice document cannot be found — usually because the phone
or email the bill is keyed on has changed — `recordUnmatchedPayment` files it in
`unmatchedPayments` and texts the office, if an alert number is set. **What happens now:**

- **A System inbox note**, written by the server at the moment the capture is filed and
  deduped on the capture id, so she hears about it *before* the next night's invoices go out
  (Addie: *"we need unmatched invoice to come up in system inbox before we send it out"*).
- **A Health Check row**, `unmatchedPayment` (MON-29 — *"Put that in health check."*), fed by
  `hcLoadUnmatched`, which leaves `hcUnmatched` **null** on a failed read so a silence is
  never mistaken for an all-clear.
- **A banner on the Invoices tab**, `renderUnmatchedPaymentBanner`, naming the customers the
  payment might belong to.
- **A way to clear one**: Health Check's *Not a problem*, which writes to
  `healthCheckDecisions` and **never** to `unmatchedPayments` — so that collection stays
  `allow write: if false` and **no `firestore.rules` deploy is needed**.

**What is still open.** Whether an unmatched payment may ever be *applied* to an invoice from
Health Check — the remaining half of **Q-025**. Applying it, refunding it and marking it seen
are three different answers about somebody's money, and only *where it shows* has been
settled. That is why none of the three surfaces above carries a fix button.

---

*The original entry, kept because it is why the remaining half is still open:*

> Three things were true at once, and each was checked rather than assumed: nothing anywhere
> writes `resolved: true`; no screen in `admin.html` read that collection at all;
> `firestore.rules` says `allow write: if false`, so even a screen that existed could not mark
> one dealt with. Meanwhile the customer's own portal reads **Paid in Full**. Real money,
> correctly captured, in a place with no way in and no way out.
>
> ⚠ **It was drawn on the path as an ending**, because that is what it was — money in, nothing
> out. Drawing a route onward would have described a repair nobody had built, and the value of
> that page is that it is true.
>
> ⚠ **Letting the office write to that collection needs a `firestore.rules` change, which CI
> does not deploy** — it needs `firebase deploy --only firestore:rules` by hand. That
> constraint is exactly why *Not a problem* was built to write somewhere else instead.

⚠ **And it is a hole, not a ruling**, so the finding itself is deliberately not in the
questions map — that file holds judgement calls she made. Her answers *about* it are: MON-29
(where it shows) and MON-30 (the inbox note and the invoice banner).

### The Connections page — the path, the tabs, and what runs by itself

**The path is a graph you walk, not a list you read.** 43 steps, four ways in, and every
step offers the things that can happen next.

**Four doors, and one of them is new (2026-08-30).** Addie: *"for old costumers are
starting point is just at RSVP can we work on those paths to"*. `rsvpasked` was a
*through*-step, reachable only by walking the whole first-season path from a quote — so
the ~960 people already on the books had no starting point of their own. It is a start
now, and it gained the date it always should have had (`rsvpSentAt`, the stamp
`seasonRuleIsLive` reads to decide whether anybody may be dropped for not answering).

The returning path was also **thin**: a yes went straight to the warehouse. It now draws
what a yes really does (`seasonYesUpdates` cancels a queued recycle, re-queues a build
only where that recycle happened, clears the badge in both its fields, and stamps both
the planner's instruction and the office's badge), plus the price-only re-quote where the
warehouse does nothing, and the second door out of the season — **the office badging
somebody Back Next Year**, which is a different field from the customer answering the link
and is the exact split `isOutForSeason` was fixed for.

**A pedigree per tab** (2026-08-30). Addie: *"make a pedigree branch for each of the
following tabs"* — Quote, Customers, Routes, Schedule, Warehouse, Invoices. Each drops you
into the **same graph** at that tab's own root, so a step can never say one thing on the
full path and another on its tab. Each names where its work hands off, and the hand-offs
**form a chain**: Quote → Customers → Warehouse → Schedule → Routes → Invoices, each one's
hand-off being the next one's root. ⚠ That order is the order work really happens in, not
the order the tabs were listed — a bundle is built before a day is planned.

**Two path errors were found and fixed** while checking it:
- `newMemberFeeAppliedAt` was drawn on **Paid**. `runInvoiceBatch` stamps it when the
  invoice is *built*, so the page said a customer is charged their $30 at the moment they
  settle — the one place somebody querying that charge would look. It is on **Invoiced**.
- **Back next year** went only to a fresh quote. Somebody already a customer gets the
  *RSVP* next season; only a lead who was never converted gets quoted again. It forks now.

**The branches are drawn, not listed.** Two generations: every way out of here, and under
each of those, what *that* leads to — so a branch that fans into four looks different from
one that runs straight on, before anything is clicked. Two generations and no more is not
a style choice: the graph has real cycles and an unbounded draw never terminates. A
grandchild is a **label, not a button** — making it clickable would let somebody skip the
middle step and leave a trail claiming a route they did not take.

### "760 undeclared connections" was mostly a scanner that could not tell records apart

Addie picked five areas to work through — **quotes, warehouse, invoices, schedule,
customers-RSVP**. Measuring them before starting showed the headline number was badly
inflated, and saying so is the point: `status` alone reported **184**, and its list was
`ccRenderCardList`, `ccStatusColor`, `approveTimeOffRequest`, `renderExpensesList` — the
status of a **credit-card transaction**, a **time-off request**, an **expense**. Half a
dozen collections in this app have a field called `status`, and the matcher is
word-bounded but knows nothing about which record a field belongs to.

⚠ **Amber that carries known-false rows is amber nobody reads** — `engine.js` says so in
its own header, about a two-row collision. At 184 it stops being noise and becomes the
reason the column had never been worked through.

**`otherRecord()` drops a touch only when it can positively identify it as somebody
else's**: the function around it names other Firestore collections and never names this
field's own. `renderExpensesList` says `expenses` and never `quotes`, so its `status` is
not a quote's.

⚠ **"Cannot tell" always means keep** — a function naming no collection, one naming this
record too, a touch outside any named function, or a spine on a record the filter has
never heard of. A false drop makes a real connection invisible, which is the failure this
page exists to prevent; a false keep is one more amber row.

⚠ **The collection list is read out of the source, never written down.** A hard-coded list
goes stale the day somebody adds a collection — and stale in the *silent* direction: the
new collection stops counting as "another record", so its fields start appearing as false
amber on somebody else's spine.

**760 → 665**, and `status` **184 → 117**. What is left is largely real: `customerNumber`
still has 135, and those are genuinely the warehouse's — `cnBuildPrintTable`,
`cnBulkAnalyze`, `cnHighestAssigned`, the exports. That is the work Addie asked for, and
it is now readable enough to do.

⚠ **The hand-written `ignore` lists stay.** They name functions that genuinely touch the
right record for a reason that is not a connection, which no amount of collection-sniffing
can work out. This runs after them.

### Declaring the five areas Addie picked

Working order: **Schedule and Customers-RSVP first** — the two small enough to *finish*
rather than dent — then Warehouse, Quotes, Invoices.

| Area | Declared | Undeclared |
|---|---|---|
| **Schedule** | 32 | **2** (was 56) |
| **Customers-RSVP** | 36 | **4** (was 40) |
| **Warehouse** | 92 | **10** (was 170) |
| **Quotes** | 45 | **27** (was 159) |
| **Invoices** | 79 | **14** (was 215) |

**All five are done. 760 → 57 across the whole map.** What is left is almost entirely
anonymous handlers, which cannot be attributed to a named function and are the honest
floor of this technique.

**What declaring found.** `stops` went from 42 undeclared to **nought**, and the entries
are the ones that matter: the 15-minute route sweep rewrites the frozen list a crew is
handed, `resyncSavedRouteStops` pushes a corrected address onto a saved stop,
`removeCustomerFromUpcomingRoutes` exists **twice** (browser and server, because a customer
taking themselves out is not signed into the office), and `portalSave` can touch a stop
from the customer's own page. On `rsvpStatus`, the one worth reading twice is
**`seasonYesUpdates` in admin.html** — a second implementation of what a yes does, beside
the server's, which is the shape money-parity exists for.

**And two more matcher faults surfaced, both in the silent direction:**

- **A local declaration was counted as a write.** `const completed = !!d.completed` reads
  the field and names a local after it; `let deposit = 0` names one after a field it never
  touches. Both matched `= ` and were counted as *writers* — **45 across the map**, and
  the worst kind of amber, because they sit inside functions that genuinely do handle the
  right record, so no record filter can see them. **665 → 560.**
- **Destructuring is invisible.** `const {completed} = d` produces no hit at all — not a
  write, and not a read either, because `hits()` decides a read from the character before
  the name and `{` is not one of them. Found by writing a check that assumed the opposite.
  It happens **zero** times in the real files today, so building for it would be building
  for nothing — but the *assumption* is now gated: if somebody starts reading a watched
  field that way, it goes red and a person decides.

**Warehouse, and a third matcher fault.** `customerNumber` went 134 → 2 and the build
flags to nought. The writers are what matters — this is the number a bin gets labelled
with, and two houses wearing one label is the mistake the field exists to prevent. On
`needsLightBuild` the two the office cannot see happening are both the portal: a customer
changing their own colours queues their own rebuild, and a customer saying yes again after
a no puts the build back.

⚠ **A ternary's colon was read as an object key**, so `d.field ? 'a' : 'b'` counted as a
*write* — ten across the map, in the more misleading direction, because a phantom writer on
a money field is exactly what somebody would go and investigate. **And the obvious fix was
wrong**: deciding "property access ⇒ read" first broke twenty real declarations in one go,
because every `updates.field = value` in the app became a read. Assignment is tested first;
only then does a colon after a property mean a ternary. Both directions are gated, because
the ordering looks right either way round and is only correct one of them.

⚠ **Three families are excluded from `customerNumber` with reasons rather than declared
one by one**: a route stop carries a *copy* of the number (that is the `stops` spine's
business, declared there); dozens of `print*`/`render*` functions *show* it, and a screen
that shows a number is not a connection anybody needs to police, while one that *decides*
something with it is and those are declared; and a rank table named after fields
(`{street: 1, housePrice: 2, customerNumber: 4, …}`) reads as a write to any matcher.

**Quotes, and `status` is six fields wearing one name.** A QUOTE's status, an INVOICE's
(`computeInvoiceStatus` — its own field, and it still has no spine), a credit-card
transaction's, a time-off request's, an SMS delivery receipt's, and an HTTP response's
(`res.status` in the measure tool). The record filter catches the ones whose function names
another collection; a fetch and a Twilio call name none, so those stay hand-written. 98 → 23.

**Invoices — the money.** Every writer of `deposit` can lose a recorded payment, which is
the one mistake here with no cheap undo. The rules are recorded beside each: Invoice Bulk
Update preserves an existing payment rather than zeroing it; the Edit Customer save writes
the change fee LAST, after `syncPayerInvoice`, because that rebuild would overwrite one
written before it; Start New Season clearing `chargeNewMemberFee` is what stopped the join
fee being charged every season. 215 → 14.

⚠ **A duplicate key in a spine silently discards the earlier one**, and I introduced one:
a second `ignore:` on `deposit`, where the later key wins in a JavaScript object literal —
an exclusion list that reads as active and does nothing, which is this page's own fault
shape occurring in its own data. Nothing would have said so; every other check passed and
the counts moved as expected. Now gated for every spine key.

⚠ **And a two-part script half-applied again.** The invoice READER declarations were in a
script that aborted on an assertion before writing, so the `ignore` fix landed and the
declarations did not. Caught by the red-check reporting three MISSes — the sabotage could
not break a declaration that was never there.

⚠ **A label map is not a write either.** `renderAllCustomersTable` holds
`{completed:'Install Complete'}` so a filter can be shown in words. That one cannot be
worked out mechanically and is a hand-written `ignore`, like the test-record builders.

### What runs without anybody pressing anything

Addie, 2026-08-30: *"where things go does not have a complete representation of the
automation. There is still things missing there."* She was right, and the grid could not
have shown it — that grid is field × **screen**, and automation is not a screen. The only
automatic run with a column was the 7pm billing; **Automation Emails was folded into the
Portal column**, which is simply wrong (an automation email lands in a customer's inbox).

`connections/automation.js` lists all seven with cadence, what each writes, and — the row
that earns the list — **what it would cost if it stopped**. Five of the seven are *not*
watched by the grid, and the page says so rather than implying coverage it does not have.

⚠ **The list is gated from the code back to the list.** `connections.test.js` sweeps every
`onSchedule` and every named `setInterval` out of the four source files and fails if one is
not on it — the same direction as the portal whitelist and the collections table, and for
the same reason: every check that existed asked *"is the declared thing still connected"*,
so a run nobody declared was absent from the question.

⚠ **And an anonymous long-lived timer is now refused outright.** The sweep finds a timer by
the variable it is assigned to, so `setInterval(function(){…}, 600000)` with no name is
invisible to it — which is exactly what the ten-minute re-read of the nightly billing log
was: *the one alarm on the most expensive automatic run in the app*, unfindable by the list
that exists to say what runs by itself. It is `nightlyHealthTimer` now.

### What the customer's own page can actually see

The member portal never touches Firestore. Everything it knows comes back through
`portalLookup` / `portalSave`, both of which return `sanitizeRecord(data)` — a copy
containing **only** the names in `PORTAL_READ_FIELDS`. A field that is not on that list
arrives as `undefined`. **Nothing throws**; `|| ''`, `|| 0` and `|| []` turn it into a
plausible empty and the page renders as though the record held nothing.

**Found 2026-08-30: the member portal's sides-changed re-quote was sending five blanks.**
A customer changes which sides of their house are lit; the portal raises a quote and — per
Addie, 2026-08-18, *"we should be able to find what their old # was no matter what"* —
carries everything the old record knew. It reads five of those values off
`currentJobAddressData`, and `customerNumber`, `measuredFeet`, `numberOfBins`,
`lightColors` and `housePrice` are **not** whitelisted. Measured by running the real
`sanitizeRecord` over a real record: only `lightsDescription` survived. So the office's
*"On file"* strip read **"On file: no number"** above an instruction reading *"same
number, same bin, same lights"* — and finding the number meant opening All Customers,
which is the one lookup that strip exists to save.

⚠ **The exclusion is right and was not reversed.** That list's own comment names
*"pricing, customer number, bin assignments"* as things that never leave the server, and a
value handed to the browser only to be echoed back proves nothing anyway.

⭐ **`requoteOnFile` derives them at render time** from the live customer (`custById`, via
the quote's `existingCustomerId`), falling back to the stored `existing*` snapshot for a
quote whose customer has since gone. Same answer `invoiceDisplayName` gives to the same
shape of problem — and it fixes the **staleness** a snapshot always had, where a footage
corrected after the re-quote was raised left the strip quoting the old figure for ever.

⚠ **And when it genuinely knows nothing it says so**, naming All Customers. "On file: no
number" under "same number, same bin" is unusable silently.

**Two office-side writers fill different halves of the snapshot**, which is worth knowing:
Edit Customer's re-quote writes `existingCustomerNumber` and nothing else; the portal's
writes the other four (as blanks). Neither ever filled all five. Deriving live makes that
moot.

**The other direction — whitelisted and never read.** Six fields are sent to the browser
and never looked at, each declared with what is and is not true of it. **Two of them were
protections that had been asserted and never built**, and are now real (Q-028; Addie:
*"Okay make a protection"*):

- `cannotBillNoEmail` → **`renderNoEmailNotice`**, a notice at the top of the invoice card.
  It *asks for the address* rather than announcing a problem — "we cannot bill you" is
  alarming to somebody who has done nothing wrong and gives them nothing to act on — and
  says in as many words that nothing is wrong with their account. It is **derived, not
  just stored**: the flag is only cleared by the next nightly pass, so an email typed at
  nine in the morning would otherwise be nagged about until seven at night. The nightly
  run only ever sets it on the **payer**, so this can never tell a tenant to go and fix
  their landlord's record.
- `askSameAsLastYear` → a branch in **`renderScheduleStrip`**. It replaces *"You're on the
  list for this season. We'll be in touch with your install date"* — an install date, for
  a season they are not booked for — with a line saying we are working out whether last
  year's setup will do, and that nothing is needed from them. It sits **below** the
  scheduled-date branch: a house with a date was decided in practice, and saying otherwise
  is the same contradiction pointing the other way.

Both are **run against jsdom**, not matched in the source: every claim about them is about
a line on a page, and a regex over the file is a different and weaker claim.

*Gated by* `portal-fields.test.js` (`npm run test:portal-fields`), which sweeps from the
**code back to the list** — every property `index.html` reads off a sanitised record must
be whitelisted or declared, and every whitelisted field must be read or declared. That
direction is the point: every check that existed asked *"is this listed field correct?"*,
so a field never put on the list satisfied all of them by being absent from the question.

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

### A new fault tells the office, and the notice goes away when it is mended

Added 2026-09-11 ([[FIX-02]]). Until then **raising a fix was completely silent.** All four
doors did was tick `needsFix`. The house then appeared on the fix list and on a Fixer Route
sheet — both of which somebody has to go and *look* at — so a fault reported on the phone on
a Tuesday sat unseen until whoever raised it happened to open the right tab. Given the point
above, that is a bill held open with nobody told.

Marking Needs Fix now writes a **System notice** — filed under *Schedule & Routes*, tagged
*Repair / Issue*, carrying an **Open their card** button that opens Edit Customer straight
from the Inbox. Marking the fix done **deletes that notice**, which is Addie's own wording
("the note disappears when it's done"). Nothing is lost by the deletion: `fixRaisedAt` and
`fixDoneAt` stay on the customer record and are the permanent trace of how long the customer
waited.

⚠ **Raised in the one door, not at the four callers.** That is the lesson of the section
above stated forwards: anything bolted onto a caller reaches some of them and reads as
working. Both halves sit in `hlxMarkJobDone`, so a fifth door added later announces itself
without anybody remembering to wire it.

⚠ **The notice's document id is derived from the customer** (`fix-<id>`) rather than
auto-generated. That buys both halves of the ruling at once: raising twice writes the same
document, so toggling the box off and on cannot stack four notices about one house; and the
clear is a plain delete needing neither the messages cache nor a composite index. Finding it
by topic-plus-customer would need a composite index, and `firestore.indexes.json` is **not**
deployed by CI — so that query would fail silently in production while passing every check.

⚠ **It never re-marks a notice she has already read.** A bare write would reset `read` on
every toggle, which is the cries-wolf failure this repo names in four other places.

⚠ **The fix photo is destroyed on the spot, not parked** ([[FIX-06]]). FIX-02 originally
asked for park-then-destroy with an undo; Addie reversed it on 2026-08-21 — "we want the
picture destroyed on the spot" — and R-024 applies. What makes a no-undo destroy safe is the
order and the condition: the record is written first, only `done === true` destroys anything,
the field is cleared only if the picture really went, and a failed destroy keeps the URL so
the next Mark Done retries rather than orphaning a public Cloudinary asset. The house photo,
which prints on the new-hang crew sheets, is never touched.

⚠ **A comment in `admin.html` claimed this was unbuilt for three weeks** — it said the fix
kind "does not retire the fix photo yet" while the call sat twenty lines below it. Corrected
in the same change.

### Everything about the season RSVP is on the RSVP tab

Moved 2026-09-11. Addie: "at the top we got a lot going on. We can probably move emails that
didn't get sent out over to RSVP in it's own sub tab. And Text the RSVP can go in it's own
sub tab as well in RSVP."

Two cards used to sit on **Templates**, above the templates themselves — a tab somebody
opens to *edit an email*, carrying two cards about the state of a send. The RSVP tab now has
three sub-tabs: **Daily send** (the paced 200-a-morning plan), **Did not send** (the people a
send lost), and **Text the RSVP** (the people with no email on file). `Send the whole RSVP`
deliberately stays on Templates — it is one press beside the templates it sends, and moving
it would break the one route the office already knows.

⚠ **The sub-tabs do not use `route-tab-btn` / `route-tab-panel`, and that is load-bearing.**
The Automation tab handler clears `active` from *every* element with those classes under
`#panel-automation` — a panel-wide sweep. Reusing the names would leave the RSVP tab opening
with no sub-panel active at all: a blank tab, which reads as the feature being broken rather
than as a naming collision. The obvious future tidy-up is to rename them to match, so
`rsvp-subtabs.test.js` fails if anybody does. `rsvpSubtabShow` is the one place the state is
set, called both by the sub-tab clicks and by the Automation handler when the tab opens.

⚠ **The failure count moved onto the tab.** That card used to hide itself until a send lost
somebody, and its own note says why: it has to be *noticed on the day it appears*, because
until those people are emailed they cannot RSVP and an unanswered customer is out of the
season. Behind a sub-tab, hiding it would be worse than before — it would be behind a tab
nobody had a reason to open. The tab wears the number instead, and the empty sub-tab says
plainly that nothing has failed.

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

- **The whole admin page is dead, and the console names an error nowhere near anything you changed** → read the FIRST error, not the loudest one, and look at the line it names. On 2026-09-09 the log read `ReferenceError: Can't find variable: async  at admin.html:20204`, then twice `Cannot access uninitialized variable.  at admin.html:42670`. One cause: a stray `async` left alone on line 20204 by an edit that removed the function it belonged to. On its own that word is just a name JavaScript cannot find, so the script stops there — and the two errors twenty thousand lines lower are simply the things it never got as far as creating. A whole script dying part-way always looks like several unrelated faults at once; the one to fix is the first. `npm run verify` now refuses this before it can be pushed.
- **A quote email shows "(quote token not found)" where the Approve / Maybe / Decline buttons should be** → the quote those buttons belong to has no `quoteToken`, so there is no link to put behind them. A token is normally minted in the customer's own browser when the public quote form is submitted, and until 2026-09-11 the PORTAL's re-quote — raised when a member changes how many sides of their house are lit — never minted one at all. Miko Johnson's is the one that reached the office that way. Two halves are fixed: the portal create writes a token like every other quote, and the email renderer mints one on demand, which is what rescues every quote already sitting in the book without one. ⚠ **AND IT WAS PICKING THE WRONG QUOTE AS WELL.** The renderer took the FIRST quote sharing the customer's phone number, in cache order — Addie's own number carries five quotes and every one is CLOSED — so a live email could carry the token of a quote answered weeks ago, inviting the customer to re-answer history while the quote actually in front of them stayed untouched. `quoteForButtons` now skips closed and archived quotes and takes the newest of what is left, and returns nothing at all when there is no open quote, because buttons pointing at an answered quote are worse than no buttons.
- **A route/customer list is empty with no error** → check `firestore.rules` first for that collection. A collection missing a rules entry is denied by default and fails *silently* in a listener (no console error a non-coder would notice).
- **A field the portal should show is blank or stuck at 0** → check whether that field is in the relevant Cloud Function's *read whitelist* (`PORTAL_READ_FIELDS`, `INVOICE_READ_FIELDS`, `QUOTE_READ_FIELDS` in `functions/index.js`). The portal only ever sees a function's sanitized output, never the raw document — a field can be correctly written and still invisible to the customer if it's not on that list.
- **You cannot tell why somebody is not going out** → the Route column on All Customers now carries a line under the status saying so — *"Not scheduled — owes $400.00 from last season"*, *"— no RSVP yet"*, *"— they said no"* — and Edit Customer shows the same sentence with what clears it. It is `seasonHold`, gated on `isOutForSeason`, so it can never disagree with whether a crew is actually being sent, and only the money reason is drawn in the warning colour because the RSVP pill above already states the others (RS-26).
- **A customer who answered yes is on no route, and Waiting on RSVP does not list them** → check **Schedule → Owes from last year**. Owing from last season holds them out of the season on its own, and it is deliberately outside the RSVP rule, so they do not appear on the waiting list. The amount and what clears it are on that pane.
- **Somebody is held who you know has paid** → the payment is not on the invoice. There is no override by design (RS-25): record the payment, or credit the amount off, and they rejoin the season on the next draw.
- **An invoice's balance/status looks wrong** → check whether `changeFees` is actually being included in that particular screen's math. This was the P0 bug for this pass; the formula is documented in §3 so any *new* code touching balances can be checked against it.
- **A route change (address, gate code, name) isn't reaching the crew** → check whether the route is *upcoming* — both resync paths deliberately skip past/history routes. Also remember only `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber` are ever frozen into a stop; other fields are supposed to be looked up live, so if one of *those* isn't updating, the live-lookup code itself is the place to check, not the resync.
- **Firestore is throwing `failed-precondition`** → almost always a missing composite index. The index (or rules) file being correct in the repo means nothing until `firebase deploy --only firestore:indexes` (or `:rules`) actually runs — Netlify never touches Firebase, and a correct file sitting undeployed looks identical to a wrong one from the app's point of view.
- **A customer's bin/number logic looks off at exactly 200 or 260 ft** → the cutoff in code is **320 ft** since 2026-09-10, and was 260 before that (see §2). Check `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js (they moved out of admin.html) before assuming a bug.
- **A big house shows fewer bins than it needs** → check whether the code doing the deciding tests `numberOfBins === 2`. Bins go up in 320s, so a 900 ft house is 3 bins; `=== 2` reads that as "not a double" and hands it a regular customer number.
- **The same System notice arrives twice, word for word, minutes apart** → treat it as a sweep loop, not as noise. A sweep doing real work finds *less* to do next pass; a byte-for-byte identical notice (same counts, same names in every list) is the signature of one pass undoing another. Check that eviction and the cap/top-up are asking the same question about the same day — `routeDayTowns` is the single answer, and `stopProblem` and `evenOutDays`/`fillDays` must all read it (§5).
- **A button on a generated page does nothing at all, with no error** → look at what is being written into the button, not at the handler. On 2026-08-27 not one of the 181 blocks in the Rules view would open, because a rule name Addie wrote carries a double quote (`Is a pooled number somebody still holds "available"?`) and it was being pasted straight into the button's hidden label — the quote ends the label early, the button hands back a chopped-off name, the lookup finds nothing and the click quietly does nothing. Anything taken from `claude/questions-map.md`, from `connections/manifest.js`, or from a customer record is prose somebody typed, so it must be escaped at every point it is written into the page — and never at the source, because the real text is what every lookup is keyed on.
- **A crew-day appears for a town nobody recognises** → look at that customer's `city` field on the record, not at the scheduler. `extractCleanCity` only strips zips and `UT`/`Utah` and drops any part containing a digit, so a *street* typed into the town field (`S Summit Crest Ln`) survives cleaning and reads as a town. Since 2026-08-31 the builder **refuses to seed a crew-day from one** (`townIsPhantom`), so those houses are left unplaced and named in the "Routes Kept Up To Date" notice under *these houses have a street in the town box*, with the bad value quoted. That line **is** the fix: correct the town on the record, and the customer sync carries it across. Before this, the invented town got a crew-day of its own, borrowed real houses from a neighbour to fill it, and `stopProblem` evicted those borrowed houses again on the next pass — the eviction/replacement loop behind twenty identical System notices a day.
- **The console names a function that is not defined anywhere** (`renderFolderSidebar is not defined`) → a feature was removed and a CALLER was left behind. Search the file for the name: if it appears only at call sites and never as a declaration, that is the whole fault. Do not re-create the function — find what REPLACED it (the Communication Centre's `renderCommNav` replaced the folder sidebar on 2026-09-09) and point the callers there. ⚠ **And a `<name> is not defined` for an ORDINARY word like `item` is the opposite case** — a scope slip, not a deletion. That name is defined plenty of places, just not the one it is used in; look at the enclosing `forEach`/`map` and check its parameter is the name being read. Both shapes PARSE, so no gate here catches either.
- **Most of the admin page does not work, and the console says `X is not defined` followed by `Cannot access 'Y' before initialization`** → that is ONE fault, not two, and the first line names it. Something threw at the module's TOP LEVEL, so evaluation stopped there and everything declared below it never initialised — the second error is the wreckage. Read the line number in the FIRST error and look at that line. On 2026-09-09 it was `admin:20204`, a bare `async` left standing when a commit deleted `async function addMessageFolder(){` and cut the line in half. ⚠ **It PARSED**, so `npm run verify` was green and both required CI checks passed — a lone keyword is a legal identifier expression, and nothing in the suite evaluates admin.html's module top level. `silent-failures.test.js` now catches that shape (a modifier keyword alone on a line) and names the file and line. ⚠ **If the first error is something the gate does not cover**, the same reasoning still applies: find the top-level throw, not the TDZ complaint underneath it.
- **A house was re-measured but the route card, the crew sheet or the customer record still shows the old picture** → check WHEN it was measured. Until 2026-09-09 **Attach to Quote wrote the photograph to the quote and stopped there**. A quote's photographs live in `quotePhotos`; a customer's live in `housePhotos`, and the only thing that had ever carried one across was CONVERSION (`fillAddCustFromQuote`) — so on an already-converted customer, which is every re-measure, the picture never reached the record the crew reads. `rmPushPhotosToCustomer` now runs in the same press as the feet and the price ([[MR-40]], finishing [[MR-25]]). **It APPENDS**: a customer who already had a photograph keeps it as their main one and gains the measured picture beside it, so an old main photo staying put is correct, not a failure — the new one is on the record, further along the strip. Anything attached BEFORE that date is on the quote only and has to be added to the record by hand.
- **Attach to Quote thinks for a moment and then says nothing at all** → that is a THROW, not a refusal. Every deliberate way out of `rmAttachShots` prints a line; a rejected promise printed nothing, left the gold button disabled and looked exactly like a click that never registered. Since 2026-09-09 both buttons go through `rmAttachSafely`, which catches anything the attach throws, puts the error's own words on the line beside the button, re-enables it, and files the reason to **Inbox → Admin Errors**. ⚠ **So a silent Attach now means something else** — the page failed to load at all, or the click is not reaching the button. Check the red error badge first.
- **Measure Roof's Attach to Quote says "Nothing uploaded"** → read the rest of that line, and believe it over the button. Since 2026-09-09 the message carries the picture service's own words, because for one afternoon it said only *"Nothing uploaded — try again."* while Cloudinary was answering every request `401 cloud_name highlighting-utah is disabled` — the whole account switched off, so retrying could not work at any hour of any day and the office was sent to the one action guaranteed to fail. **A disabled account is a billing problem at Cloudinary, not a bug in Attach**, and it takes down every photograph already on a quote as well as new uploads (delivery from `res.cloudinary.com` 401s too), so the symptom to expect alongside it is blank pictures across the whole app. Check it in one line from any machine: `curl -s -D - -o /dev/null https://res.cloudinary.com/highlighting-utah/image/upload/sample.jpg` — the `X-Cld-Error` header names the fault. `uploadFailAdvice` is what turns the message into an instruction; it never replaces the service's words, only leads them.
- **A house photo saved from Measure Roof is squashed into a thin strip** → the pane was scrolled mostly off the screen when the picture was taken. Since 2026-08-30 the Street View and satellite captures are a PHOTOGRAPH OF THE TAB cropped to the pane, so the picture can only ever contain what was on the glass; with a centimetre of pane showing, that is a centimetre of photograph. Jeffrey Marz's came out **893 × 36** — a house at nearly 25:1. The guard that should have caught it was reading `rect.height`, the pane's LAYOUT height, which is full at any scroll position; the collapse happened afterwards, where the crop height is clamped to whatever screen is left below the pane's top. Fixed 2026-09-11: `rmPaneClipped` measures the VISIBLE part, a clipped pane is scrolled into view and measured again, and one that still will not fit hands back `null` so the caller fetches a fresh, correctly proportioned photograph from Google instead. ⚠ **That fallback loses the drawn-on dots**, which is the deliberate trade — the office can see dots are missing, and nobody notices an aspect ratio until the crew is at the kerb. To check a stored photo without opening it, read its dimensions: a house should be about 4:3, and anything past about 3:1 is this fault.
- **Firestore's "Fetch failed" / long-poll `Listen`/`channel` message in the console** → normal reconnection noise, not a bug.
