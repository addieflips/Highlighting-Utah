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

3. **Customer approves** — the customer opens that link (no login needed) and approves or declines. This calls the `quoteRespond` Cloud Function, which is how an unauthenticated visitor is allowed to touch the `quotes` collection at all.
   - **A link that no longer matches a quote says so.** `quoteRespond` and `portalRsvp` report a miss by *throwing*, which makes the call **reject** on the customer's end — so until 2026-08-31 every such link showed "Something went wrong", the wording meant for a server fault, and the accurate "we couldn't find your quote" line could never appear. An out-of-date link is ordinary (the quote was deleted, or re-sent), so it now says the link may be out of date and to ask for a fresh one. `portalCallFailedText` is the one place that wording lives, and all six branches ask it.
   - ⚠ **A genuine outage still reads as one.** Anything that is not a not-found keeps the generic message, and the real error is logged to the console — calling every failure a stale link would hide a real fault behind a reassuring sentence.
   - ⚠ **Approved is not the same as Ready to Convert.** That folder means approved **and** the install-details form completed, so nothing lands there half-filled. A new customer approving gets that form. An **existing member does not** — they are asked "anything changing this year?" instead — so an approved re-quote stays in **Awaiting Response** until the office presses Mark Approved. Known gap, not yet decided.
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

   - **Who it writes to:** owes for a previous season **and has never answered the RSVP**. Not a no, not a
     back-next-year (RS-30 — they have answered), and not a yes (the template asks whether they want lights,
     which to somebody who already said so reads as us losing their answer).
   - **Once per customer per season**, via `arrearsRsvpEmailAt`, cleared by Start New Season — and stamped
     only *after* the send succeeds, so a refused send does not silently drop them for the year.
   - **No figure in the email.** There is no token for the carried balance and `{{amount_due}}` means this
     year's install price (RS-37), so the buttons carry their portal token and the portal shows the figure.
   - The **test record carries Addie's own phone**, so it is skipped by flag and by name-and-number both.

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
   - ⚠ **It is NOT `portalSave`, and that is the trap.** `gateCode` is in `portalSave`'s `info` whitelist, so reusing it looks clean — but that section ends `updates.seasonStatus = 'needs_changes'`, the **re-quote state**, resolved by answering a quote. No quote exists here, so every customer who typed a gate code would sit in Needs Changes for ever. `portalSetGateCode` writes one field and nothing else.
   - ⚠ **The browser specs cannot see the server half.** `test/rsvp-gate-code.spec.js` drives the page against a fake Firebase; `gate-code.test.js` holds `functions/index.js`. A red-check proved the split was needed — breaking the real server's return left all ten browser specs green.

   ⚠ **A member is never re-asked for details they already gave.** That rule is the same one behind "an existing member does not get the form" in step 3 above; this was that rule leaking through a different door.

   ⚠ **AND A REMEMBERED SIGN-IN USED TO SWALLOW BACK NEXT YEAR ENTIRELY** (fixed 2026-08-31, the same day and a *separate* bug from the one above). index.html remembers a portal login in `localStorage`, and the block at the top of the file sends anybody who has one straight to `#/payment`. Its test for "are they at the root" was `!initialHash || initialHash === '/'` **with no query test at all**, while `onBarePaymentPage` one line up had always had one. Back Next Year is `#/?token=…&rsvp=back` — its hash *is* `/` — so it was redirected to the member portal.

   ⚠ **The answer was LOST, not just mis-displayed.** The redirect happens before `navigate()` reaches the `rsvp=back` branch, so `handleBackNextYear` never ran and `portalRsvp` was never called. The customer pressed Back Next Year and nothing anywhere recorded it — they stay Unanswered, which under the confirmed-only rule means no crew is wrongly sent, but their intention to return is gone and they sit on the **Waiting on RSVP** call list.

   ⚠ **`handleRsvpLink` calls `savePortalLogin` itself**, so pressing Yes or No on an earlier link *creates* the remembered sign-in that then swallows this one. Testing all three buttons in one browser hits it every time — which is why it survived a fix verified with empty storage. `test/signed-in-links.spec.js` opens every one of these links with a login already saved, because that is the ordinary case and not an edge one.
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
that customer. Pending is derived and never stored, so paying the bill moves the
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
same inflated figure sizes the bins at 260 ft, picks the number series and counts
the bundles at 40 ft, so a 230 ft house is filed as 265 and can be given a second
bin and a 5000-series number it does not need. Dropping the dial from 1.3 to 1.15
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

**The one correct formula, everywhere:**
```
owed = (install + removal + changeFees) − credits − deposit, floored at 0
```
This lives as `computeInvoiceStatus(install, removal, deposit, credits, changeFees)` in admin.html and is mirrored server-side in `functions/index.js`. As of this pass, every place in the app that computes a balance or status uses the full formula — that was **not** true before this pass (see the P0 fix in git history: `changeFees` had been left out of roughly 15 different call sites, including the actual PayPal charge amount).

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

**Two separate fees, easy to conflate — the set-up fee is $25, the light-change fee
is $30** (she moved the set-up one on 2026-09-03: *"make the set up fee $25"*). They
are separate charges: a new member who changes their colours late pays both.

⚠ **The set-up fee is one number in one place now** — `NEW_MEMBER_FEE`, in
`js/money.js` and mirrored in `functions/index.js` because the server cannot import
a browser module. `money-parity.test.js` fails the build the moment the two differ,
which is the thing that matters: the office quoting one figure while the nightly run
charges another. Every sentence that prints it reads it, the invoice line and the
emailed one included. It used to be a bare `30` in twelve places.

⚠ **An invoice already carrying the old fee is recomputed to the new one** the next
time it syncs — one price for the season. The exception is Start New Season, which
*strips* the fee rather than recomputing, so an old $30 invoice carries $5 too much;
that is written down at the line rather than fixed, because the fix is storing the
amount on the invoice when it is charged.

**The two, in detail:**
- **New-member fee** — added once by the nightly Cloud Function for a customer's first season, flagged `newMemberFeeApplied` so it's never double-charged. It's folded directly into `install`, not tracked as a separate line.
- **Light-change fee** (`changeFees`, with itemized `changeFeeNotes`) — added by `portalSave` when a member changes their light colors outside a 48-hour grace window. Tracked as its own field, separate from `install`, so it can be waived independently — see the × below.

⭐ **ANY FEE OR DISCOUNT CAN BE CROSSED OFF WITH AN ×** (added 2026-09-02, MON-53/54/55).
Addie: *"right now we don't have a way to waive a late invoice fee"*, and then *"to be
honest we should have an x next to all discounts and fees to get rid of those if
necessary."* Every line on either ledger — `changeFeeNotes` (fees) and `creditNotes`
(discounts) — is drawn with an × beside it, in **two** places: the Invoices panel, and
the Fees / Discounts boxes in **Edit Customer**. Pressing one saves straight away and is
written into that customer's history.
  - ⚠ **The carried debt is the one line with no ×.** It rides in the same fee ledger, and
    `arrearsOutstanding` is what holds an unpaid customer off the schedule — so removing
    it lifts the hold, which is the "hang them anyway" button Addie was offered and turned
    down. Its row says where it *is* edited (the carried-debt box below it) rather than
    showing an empty gap. **Nothing on the discount side is protected**: a credit can only
    ever be money coming off.
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
  - ⚠ **No late fee is charged today.** The rule is decided and unbuilt ($25 if they have
    paid something, $40 if they have not — PROC-32). The × is built against the ledger
    rather than against a named fee, so a late fee written later is waivable the day
    something writes one, with nothing here to change.

⭐ **A REFERRAL LINK, AND THE $25 THAT FOLLOWS IT** (added 2026-09-03, REF-01 to REF-06).
Addie: a member gets their own link, and when somebody joins through it $25 comes off the
member's bill — with nobody in the office typing anything.

- **Where the customer gets it.** A **Refer a Friend** tab in their own portal: the link, a
  copy button, and how many people have joined through it. The address is
  `.../?ref=<referralToken>#/quote`.
  - ⚠ **The link carries a referral token, never the portal login token.** A portal token
    signs somebody in; this one is pasted into a group chat. The customer number is not used
    either — it is printed on invoices and bins, so it is guessable. `referralToken` is minted
    lazily on the first `portalLookup`, exactly as `portalToken` already is, and is stable
    afterwards: a fresh token each visit would break every link they had already shared.
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
  - ⚠ **The total is rebuilt from the lines, never incremented**, and two referrals are ONE
    $50 line rather than two saying "Referral".
- **Who is refused.** Either the phone or the email matching the referrer's is a hard
  refusal, and their own record is refused first by document id. **Nothing verifies either
  field** — no OTP exists here and building one was turned down — so a determined person can
  still use a real friend's details. That is an accepted, documented gap; this rule and the
  Inbox note are the only defences. A refusal is marked on the quote so it is not retried
  for ever, and it raises its own note, because a refusal nobody can see is indistinguishable
  from the link not working.
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
- **And it is in the RSVP email too** (added 2026-09-04, REF-07). `{{referral_link}}`
  and `{{referral_button}}` are ordinary email tokens, and both RSVP templates carry the
  offer under the three answer buttons.
  - ⚠ **Two renderers, one template — the `{{photo}}` shape again.** `resolveLinkTokens`
    in admin.html renders a hand-send; `runArrearsRsvpBatch` in functions/index.js
    renders the automatic chase to people who owe. A token resolved in only one of them
    puts a literal `{{referral_button}}` in a real customer's inbox. Change one, change
    the other, in the same push.
  - ⚠ **Resolved by document id, never by phone.** `referralLinkForCustomer` takes
    `opts.customerId`, which already travels with the RSVP send. Seventeen numbers in the
    real book are shared by two households, so a phone lookup mails one household the
    other's link — and every friend they then send it to credits the wrong customer.
  - ⚠ **It mints a token if they have none**, because most customers have never opened
    the portal and the token is created lazily when they do. No link means **no button**
    rather than a button pointing nowhere.
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
  - their bill **went out 60 days ago** and is still not settled. Terms are 30 days, so a card reddens 30 days after the payment was actually due. (Asked directly: *"no 60 days after invoice goes out"* — an earlier draft counted from the due date and reddened at 90.)
  - ⚠ **Its own threshold** (`RED_CARD_DAYS_FROM_INVOICE`), not `OVERDUE_DAYS`. That one is 30 and drives the ordinary Overdue flag; sharing it would turn most of the book red in November and say nothing.
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

* **The cutoff is a veto.** A town whose forecast high for that date is at or below
  `COLD_DAY_MAX_F` (35°) is not offered the day at all. That is done as two passes rather
  than one more clause in the comparison, because of the *"unless"*: if nothing warmer has
  anybody waiting, the second pass runs with the veto lifted and the crew goes out anyway.
  The rule holds a crew back from the cold; it never holds them back from working.
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
moves them to the front of **their own tier** — and the town with them in it rises too,
since a town's urgency is the best number in it, which is the *"higher priority for where
needs to be routed"* half of the ask.

⚠ **The tiers were respaced from 0,1,2,3,4 to 0,10,20,30,40,50 for exactly this.** With
nothing between them the only way up was into the next tier, which would have let a missed
October house outrank a new hang and a missed Any house jump the whole October queue. Ten
apart leaves room for a bump of five that reaches the front of a tier and no further.
Nothing reads these numbers for their value — every comparison is `<` or `>`.

⚠ **It is recorded as a list of dates, not a counter.** Recalculate gets pressed twice in a
row and Undo puts the plan back so it can be pressed again; a counter would climb each time
and turn one missed morning into a customer who outranks the book. A list is idempotent,
and it lets somebody missed three times go before somebody missed once (`missed` is carried
into the builder's queue sort for that).

**3. A customer the office moves up by hand.** `rushInstall`, a checkbox in Edit Customer
beside the timing preference. It is the **top tier — ahead of new hangs** — because it is a
person deciding after a phone call, and an override that cannot override the automatic rule
is not an override. Both orderings read the same flag (`houseInstallPriority` for the
schedule, `installPriority` for the nightly sweep) so the two cannot disagree about who is
in a hurry.

⚠ **None of the three touches the month.** `houseAllowedFrom` and *Don't Install Before
This Date* are untouched, so a November customer who is rushed, or who was missed, is taken
first on the first **November** day and not one day earlier. The box says so on screen.

The Schedule's day panel badges a rushed house **ASKED SOONER** and a missed one
**MISSED ×n**, and the button's summary names how many of each it moved — a customer who
quietly changes place in a season is what this office rings up about.

*Where it's proved*: run-all.js **Suite 300** runs the real builder against a cold snap and
the real ordering against fixtures; 24 sabotages were red-checked against it.
*Rulings*: [[SCH-44]], [[SCH-45]], [[SCH-46]] in `claude/questions-map.md`.
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

**Kept, with a way out.** The *add another property* repeater stays — she asked for it by
name in the same breath — but each extra row now carries **Remove**. The main house has
none, because a quote with no house is not a quote. Removing takes the row out of
`quoteBuildings` as well as out of the page: the element alone would leave the object in
the array, so the submit would still send a building the customer can no longer see, read
as a blank one. A nameless extra is not sent at all.

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
- **Signed in** (phone-or-email + last name, or a personalized token link): Payment (balance + tip + PayPal/Venmo), Information (name/phone/email/address/gate code), Light Colors (subject to the 48-hour fee window), Changes (RSVP + preferences), **Refer a Friend**, Contact, Cancel (requests cancellation).
  - ⭐ **The payment panel puts Venmo last** (2026-09-01). Card and PayPal are the visible options; Venmo sits inside a closed **Other payment options** dropdown, and the Venmo **QR code has been deleted** — it was a ~30KB image on every load that asked the customer to type the amount in themselves. The dropdown is a plain `<details>`, shut by default with no JavaScript, and re-shut on every render so a tip or an instalment cannot leave it hanging open.
  - ⭐ **A customer carrying last season's debt pays that first, and the bill shows the two apart.** Last year's balance gets **its own card above this season's**, each with its own subtotal — Addie: *"I need the unpaid last year to look more obvious but still nice and organized."* `paypalCreateOrder` charges the carried balance and nothing else while it is outstanding; once it is paid, the same button comes back offering this year's. `renderArrearsNotice` says so in words, because a button charging less than the balance above it reads as a mistake or a double charge. Proved on the real page by `test/arrears-portal.spec.js`.
    - ⚠ **The total above the button reads `portalPayableNow()`, not the whole balance.** It was `currentServiceDue = totalDue` and had never been repointed when the button started charging only the arrears — so the panel printed **Total Payment $1,146.00** directly above a button that would take **$200**. Addie saw it and reported it; the specs at the time proved the notice and the button and never looked at the total between them.
    - ⭐ **There is also a way to clear the whole account**, for somebody who does not want to pay in two goes.
    - ⚠ **A tip goes to the crew, not onto the bill.** `paypalCaptureOrder` used to call everything above the balance due a tip (`serviceAmount = min(captured, balanceDue)`), which was right while the button charged the whole bill and **wrong from the moment it stopped** — so while only last season was being charged, a tip landed on the bill instead of reaching the crew. Live from the day the split shipped, and invisible from the screen.
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
  - `noAutomationEmails` — the **do-not-send list** (added 2026-08-21). Set two ways, both writing the same field: the *Don't send* button beside a name in Automation Emails → Preview & Send, or the **Don't send this customer marketing emails** tick in Edit Customer. Cleared by *Allow again* in that panel's "Show who I've excluded" view, or by unticking. Read by exactly two places, both of them automation-email senders: the Preview & Send recipient list and the older Send Template modal. Somebody on it is dropped from both lists before rendering, so **Select All cannot reach them**, and both send loops check again at send time in case a row was ticked just before they were added.
  - **Where a preference is visible.** `CONTACT_PREFS` in `admin.html` is the one list of ways somebody has asked not to be contacted, and three screens render from it: the two tickboxes in Edit Customer, a red chip per preference on the All Customers row, and a muted line on the printed invoice (*"Contact preferences: no text messages."*). Somebody who has asked for nothing gets no line at all — printing "preferences: none" on every invoice trains the eye to skip the place the real ones appear.
  - ⚠ **The invoice prints preferences and can never act on them.** `contactPrefsNote(d)` returns a finished string, and `buildInvoiceDocHtml` is handed that string rather than the flags — so nothing in the invoice builder can branch on a contact preference, because it never receives one. Suite 128 asserts the builder names neither field directly. The Edit Customer tickbox says outright that they still get their invoice and account notices, since the one dangerous misreading of that box is that it stops their bill.
  - ⚠ **`noAutomationEmails` never stops a bill.** It is named for its scope on purpose — the obvious name (`emailOptedOut`) invites someone to wire it into the nightly invoice run, and a customer who asked to stop getting marketing would then silently stop being **billed**. Nobody chases an invoice that was never sent. Neither `functions/index.js` nor `buildInvoiceDocHtml` has ever heard of the field, and Suite 128 of `run-all.js` fails if either learns it.
  - ⚠ The four other email-send handlers in `admin.html` (`sendRsvpEmailBtn`, `sendBulkUpdateEmailBtn`, `pibSendUnpaidBtn`, `pibSendPaidBtn`) have **no markup** — every id is in `KNOWN_MISSING_IDS`, so they return at their first line. That is the only reason they carry no guard. Suite 128 fails if any of them ever gets markup, so whoever builds one has to decide about the list first.
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
- **You cannot tell why somebody is not going out** → the Route column on All Customers now carries a line under the status saying so — *"Not scheduled — owes $400.00 from last season"*, *"— no RSVP yet"*, *"— they said no"* — and Edit Customer shows the same sentence with what clears it. It is `seasonHold`, gated on `isOutForSeason`, so it can never disagree with whether a crew is actually being sent, and only the money reason is drawn in the warning colour because the RSVP pill above already states the others (RS-26).
- **A customer who answered yes is on no route, and Waiting on RSVP does not list them** → check **Schedule → Owes from last year**. Owing from last season holds them out of the season on its own, and it is deliberately outside the RSVP rule, so they do not appear on the waiting list. The amount and what clears it are on that pane.
- **Somebody is held who you know has paid** → the payment is not on the invoice. There is no override by design (RS-25): record the payment, or credit the amount off, and they rejoin the season on the next draw.
- **An invoice's balance/status looks wrong** → check whether `changeFees` is actually being included in that particular screen's math. This was the P0 bug for this pass; the formula is documented in §3 so any *new* code touching balances can be checked against it.
- **A route change (address, gate code, name) isn't reaching the crew** → check whether the route is *upcoming* — both resync paths deliberately skip past/history routes. Also remember only `id, address, name, phone, difficulty, lat, lng, gateCode, specificOutlet, specificOutletNotes, customerNumber` are ever frozen into a stop; other fields are supposed to be looked up live, so if one of *those* isn't updating, the live-lookup code itself is the place to check, not the resync.
- **Firestore is throwing `failed-precondition`** → almost always a missing composite index. The index (or rules) file being correct in the repo means nothing until `firebase deploy --only firestore:indexes` (or `:rules`) actually runs — Netlify never touches Firebase, and a correct file sitting undeployed looks identical to a wrong one from the app's point of view.
- **A customer's bin/number logic looks off at exactly 200 ft** → the actual cutoff in code is 260 ft, not 200 (see §2). Check `cnBinsForFeet` / `CN_DOUBLE_BIN_FEET` in js/money.js (they moved out of admin.html) before assuming a bug.
- **A big house shows fewer bins than it needs** → check whether the code doing the deciding tests `numberOfBins === 2`. Bins go up in 260s now, so a 900 ft house is 4 bins; `=== 2` reads that as "not a double" and hands it a regular customer number.
- **The same System notice arrives twice, word for word, minutes apart** → treat it as a sweep loop, not as noise. A sweep doing real work finds *less* to do next pass; a byte-for-byte identical notice (same counts, same names in every list) is the signature of one pass undoing another. Check that eviction and the cap/top-up are asking the same question about the same day — `routeDayTowns` is the single answer, and `stopProblem` and `evenOutDays`/`fillDays` must all read it (§5).
- **A button on a generated page does nothing at all, with no error** → look at what is being written into the button, not at the handler. On 2026-08-27 not one of the 181 blocks in the Rules view would open, because a rule name Addie wrote carries a double quote (`Is a pooled number somebody still holds "available"?`) and it was being pasted straight into the button's hidden label — the quote ends the label early, the button hands back a chopped-off name, the lookup finds nothing and the click quietly does nothing. Anything taken from `claude/questions-map.md`, from `connections/manifest.js`, or from a customer record is prose somebody typed, so it must be escaped at every point it is written into the page — and never at the source, because the real text is what every lookup is keyed on.
- **A crew-day appears for a town nobody recognises** → look at that customer's `city` field on the record, not at the scheduler. `extractCleanCity` only strips zips and `UT`/`Utah` and drops any part containing a digit, so a *street* typed into the town field (`S Summit Crest Ln`) survives cleaning and reads as a town. Since 2026-08-31 the builder **refuses to seed a crew-day from one** (`townIsPhantom`), so those houses are left unplaced and named in the "Routes Kept Up To Date" notice under *these houses have a street in the town box*, with the bad value quoted. That line **is** the fix: correct the town on the record, and the customer sync carries it across. Before this, the invented town got a crew-day of its own, borrowed real houses from a neighbour to fill it, and `stopProblem` evicted those borrowed houses again on the next pass — the eviction/replacement loop behind twenty identical System notices a day.
- **Firestore's "Fetch failed" / long-poll `Listen`/`channel` message in the console** → normal reconnection noise, not a bug.
