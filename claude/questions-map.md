# Questions Map — Addie's rulings

**What this is.** Every judgement call Addie has made about how Highlighting Utah should
work, in one place, so it is never asked twice and never answered two different ways.

**What this is NOT.** Not how the system works (`system-map.md`), not conventions
(`CLAUDE.md`), not facts about the code. If a machine could derive the answer by reading
the code, it does not belong here. Only decisions a person made.

**Where it lives.** With the other Claude docs — the Project, not the repo. ⚠ There is no
`claude/` folder on `main`; only `CLAUDE.md` and `system-map.md` are committed. If that
changes, this file moves with the rest of them.

**Three rules for keeping it true:**

1. **Every session that gets a ruling appends to it before it ends.** Same standing
   obligation as the hole-hunting job — not something to do later.
2. **A superseded answer is never edited in place and never deleted.** It is marked
   `Superseded → #X` and left where it is. The old reasoning is usually why the new
   ruling is right, and deleting it invites somebody to rebuild the old one.
3. **The "Where it's proved" column is the point.** A row with a code anchor can be
   checked. A row with only a doc name is a claim. Prefer the first; mark the second.
4. **An answered question in `docs/open-questions.md` names its row here.** That file's
   *Resulting map change* line is the link, and from 2026-08-26 it must name a row ID
   (`MON-01`) when the answer was a ruling. `questions-map.test.js` enforces both ends.

**What checks this.** `npm run test:questions` — part of `npm test`, so it gates every
merge. It cannot tell that a ruling was given and never written down; nothing can. What
it does catch is the map rotting: a half-written row, a duplicate ID, a status outside
the set, and above all a `Superseded → #X` pointing at a row somebody deleted, which is
how the reasoning behind a current answer goes missing.

**Reading the columns.** *Decided* is the date on the message. A date in (brackets) means
the docs record it as settled but no dated quote survives — treat those as weaker.
*Status:* **Standing** (live), **Superseded** (answered differently since),
**Closed** (settled and explicitly not to be revisited), **Decided — not built**
(ruled on, code not written yet).

---

## Money and fees

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| MON-01 | New member who changes their lights after the first 48 hours — one fee or two? | Two, and they stack. $30 join + $30 change = $60 | 2026-08-21 | `applyLightChange` / `applyLightChangeServer`, money-parity | Standing |
| MON-02 | Where does the $30 change fee land if the invoice already went out? | Not sent → `changeFees` on the current invoice. Already sent → `carryoverCharge` on the customer, collected next season | 2026-08-21 | `applyLightChange` → `feeDestination` / `carryoverCharge` | Standing |
| MON-03 | Charge a change fee silently, or ask? | Ask. `askLightChangeFee` is a popup with more than two answers — deliberately not a `confirm()` | 2026-08-21 | `askLightChangeFee` | Standing |
| MON-04 | Does waiving the fee also waive the route lock? | No. The lock is about the crew, not the money — waiving still sets the window and still raises the note | 2026-08-21 | `lightsLockedUntil` write | Standing |
| MON-05 | When does the 48-hour window open, and does a free change extend it? | Two events open it: becoming a customer, and a *charged* change. A free change does not extend it. The free window and the route lock are the same 48 hours, one field | 2026-08-21 | `lightsLockedUntil` | Standing |
| MON-06 | Does importing 960 customers open 960 windows? | No — only Add Customer opens one on joining | 2026-08-21 | `lightsLockedUntil` — only Add Customer opens one | Standing |
| MON-07 | Who counts as a new member? | By quote, not by date and never by bulk. And it expires — a 2026 quote is not new in 2027 | 2026-08-21 | `chargeNewMemberFee`, cleared by Start New Season | Standing |
| MON-08 | Charge a fee when a takedown is marked done? | "No we don't need that we'll just add on a fee if we need that." Removal is included in the price; `removal` stays unsettable; `removalDone` touches no invoice | 2026-08-21 | `computeInvoiceStatus` | Standing |
| MON-09 | Whose name goes on a shared bill? | The lowest customer number — the longest-standing account | 2026-08-19 | `custInvoiceKey` grouping | Standing |
| MON-10 | Can one payer cover several houses, and can they see it? | Yes — one member portal, one invoice, still two separate customers | 2026-08-19 | `billToPhone`, who-pays-for-whom screen | Standing |
| MON-11 | Does changing the price in Edit Customer raise a re-quote? | It asks, with an optional reason box. Feet and address still raise one without asking — the house is measurably different | 2026-08-21 | `askPriceRequote` | Standing |
| MON-12 | Does the app ever recalculate a converted quote's price from feet? | **No, never.** The price they agreed to becomes `housePrice` — they are billed the number they saw and agreed to, and any hand-typed price survives conversion | 2026-08-26 | `housePrice` | Standing |
| MON-14 | Does difficulty change the price? | **No — feet is the price.** Charging more for a hard house was raised and deliberately left alone: it is rare enough not to be worth money code today. ⚠ NOT rejected, only deferred — if it is ever wanted it is a money change, and MON-12 already protects a hand-typed price through conversion | 2026-08-26 | `difficulty` is used for day-sizing only, never money | Standing |
| MON-15 | Several people on one bill and one of them sits the season out — when does that bill go? | "After the last persons house is done if there are multiple people on one bill is when they will be charged." The wait was already right; who counted was not. A house sitting the season out is never visited, so it can never be done — it comes OFF the bill rather than being waited for, or the bill never goes at all. ⚠ A house hung and only THEN answering back-next-year still owes | 2026-08-26 | `houseIsOnTheBill` / `houseIsOnTheBillServer`, money-parity | Standing |
| MON-16 | A house billed to somebody else — what payment status does its own row show? | **The status of the bill it was added to.** "if Kyle didn't say no or back next year and his bill wasn't already paid or partially paid but it added to Dana's bill than should be paid in full by dana." ⚠ It also removes a false reading: the zeroed leftover invoice under that house's own key computes to Paid in Full on its own | 2026-08-26 | `getLiveInvoiceStatus` keys on `billToPhone` else `custInvoiceKey`, Suite 275 | Standing |
| MON-17 | A house moves onto somebody else's bill — what happens to money it had already paid? | **The money follows the house.** Fully paid → the payer owes nothing more for it; half paid → "Just pay what hasn't been paid yet"; unpaid → a fresh bill, "they will get another bill showing what they still owe". ⭐ All three are ONE mechanism — if it ever needs three branches it has been implemented twice | 2026-08-26 | `carriedPaymentOnBillToChange` → `paidBeforeBillTo` → a `kind:'carried'` credit in `syncPayerInvoice` | Standing |
| MON-18 | Is somebody who said Back Next Year still billed for this season? | **No — take them off the bill.** ⭐ Same rule as MON-15, asked from the other side in a parallel session and answered the same way — ONE implementation, `houseIsOnTheBill`. They were already off every crew day and out of the build queue since 2026-08-22 and were still being invoiced. ⚠ Deliberately NOT `isOutForSeason`, which also means `needsLightRecycle` and would empty the whole book once `SEASON_ELIGIBILITY` flips | 2026-08-26 | `houseIsOnTheBill` / `houseIsOnTheBillServer` (folded into MON-16 on the merge), money-parity | Standing |
| MON-19 | What does each person's invoice ask them for? | **What that person is paying.** "if dana is paying for kyle than she gets her bill and kyles bill on the invoice." The payer's itemises a row per house; a house billed elsewhere shows its own price, **Due from you $0.00**, who is paying — and no status and no how-to-pay block at all | 2026-08-26 | `buildInvoiceDocHtml`, Suite 278 | Standing |
| MON-20 | When Who Pays for Whom is retired, does its Excel export survive? | **Keep the Excel export somewhere.** The whole-book view goes with the tab; the export does not. Where it lands is a placement decision, not a rule — the Invoices tab is the obvious home | 2026-08-26 | — retirement is deliberately after a season of the house tabs | Decided — not built |
| MON-21 | A house that was HUNG and afterwards said no — does it still get charged? | "Any house hung no matter what should be charged. This will only be overuled if it is our fault... if we hung the lights and there is no reason to not charge them than we will charge them still." So `completed` is tested FIRST, ahead of every status. ⚠ "Our fault" is the office writing it off with a credit — never an automatic test, which would be the app guessing at fault | 2026-08-26 | `houseIsOnTheBill` / `houseIsOnTheBillServer`, money-parity | Standing |
| MON-13 | ~~One fee or two for a new member changing lights~~ | ~~Only one — the change fee is folded into the join fee~~ | 2026-08-19 | — | Superseded → MON-01 |

## Warehouse — build, recycle, bins

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| WH-01 | One button for recycle-and-build, or two? | Two. "dont make it one button have one button for build and another for recycle." Neither may quietly do the other's half | 2026-08-21 | `recycleKeepingCustomer` / `buildTopUpFromFeet` | Standing |
| WH-02 | Can somebody who moved be recycled without being deleted? | Yes — `recycleKeepingCustomer`. Mark Recycled has a mover branch that keeps them and their number | 2026-08-20 | `recycleKeepingCustomer`, mover branch of Mark Recycled | Standing |
| WH-03 | Should an add-on look different from a house on the sheet? | Yes, three signals: `Type: ADD-ON`, a note saying it goes in the bin they already have, and a badge | 2026-08-20 | `WH_BUILD_COLUMNS`, `whPutIntoLabel` | Standing |
| WH-04 | Should the warehouse be told *why* a bundle is being built? | Yes — NEW / OLD-REBUILD / MEMBER PORTAL / REQUEST, in that order, most-work-first | 2026-08-24 | `whBuildReasonKey`, build-reason.test.js | Standing |
| WH-05 | Does that badge print? | Yes — "I need paper to carry badge too." A **Why** column on both build sheets | 2026-08-24 | `whBuildReasonLabel` | Standing |
| WH-06 | Does every sheet say how many bins? | Yes, unconditionally. "Everyone needs to know how many bins there are for each house" | 2026-08-25 | `whBinsForHouse`, both build sheets + recycle sheet | Standing |
| WH-07 | ~~Does the sheet need a bin count?~~ | ~~No — warehouse people know 5000 means 2 bins~~, then ~~only if more than 2~~ | 2026-08-24 | — | Superseded → WH-06 |
| WH-08 | Which number does the warehouse need on a recycle row? | The **old** number painted on the bin — "thats how they find it" — shown separately from how many bins | 2026-08-21 | `binLabelNumber` | Standing |
| WH-09 | Does the recycle queue need colours and patterns? | No. "they just need the customer number and name." One flat list ordered by name | 2026-08-21 | `whArchivedPending`, flat list by name | Standing |
| WH-10 | Who appears on the printed needs-building sheet? | Everyone on the warehouse tab — the same flag the tab asks, `needsLightBuild` alone | 2026-08-24 | `printNeedsBuildList` | Standing |
| WH-11 | Split the build sheet by badge, or by colour group? | By colour group — one page per group, because the group *is* the pile | 2026-08-24 | `whSheetRowsForBuild` | Standing |
| WH-12 | Is "soft" its own colour? | It counts as Warm White everywhere. She was asked and told the cost before reversing | 2026-08-24 | `houseLightsText`, `warehouse-colours.test.js` | Standing |
| WH-13 | ~~Is "soft" its own colour?~~ | ~~Yes — kept as `soft(recycled)` so those houses can be found and switched~~ | 2026-08-19 | switching list survives via `allCustFilterLights` on the raw record | Superseded → WH-12 |
| WH-14 | Colour shorthand — what does each form mean? | `rr` = two reds (a repeated letter is a count); WW and PW are **initials**, never counts; `rrgg` = `rr/gg`; anything multi-something = Multi; `pur` = Pure White, **not** Purple; clear / cool white / bright white = Pure White; plurals → singular; `mc` is skipped for good | 2026-08-24 | `rbLetterRun`, `rbLooksMulti`, `WH_COLOR_WORDS` | Standing |
| WH-15 | Does a colour list keep its order? | A set sorts; a strand keeps its order — `rrgg` and `rgrg` are two different builds | 2026-08-24 | `whOrderColors` | Standing |
| WH-16 | Can the build tab be asked about one house? | Yes — "i clicked build ashley wray but shes not here" was four different causes looking identical | 2026-08-21 | `whHouseBuildStatus` | Standing |
| WH-17 | Should a blank colour field clear the build flag? | No. "big problem, she went to the recycle but not to the build." Blank colours mean the build can't be *done*, not that it isn't *owed* | 2026-08-21 | `needsLightBuild` on the Edit Customer save | Standing |
| WH-18 | Should a house with no colours be hidden from the queue? | No — its own blocked block with an Add colours button, and marked Blocked on the sheet | 2026-08-21 | `whBuildQueueGroups` | Standing |
| WH-19 | Buffer stock — does it carry a badge? | No. No customer, so no claim | 2026-08-24 | `whBuildReasonKey`, `build-reason.test.js` | Standing |

## Customer numbers

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| CN-01 | Is a pooled number somebody still holds "available"? | No — shown as shadowed, because a number can leave the pool without the pool being told | 2026-08-20 | `cnFreePool` | Standing |
| CN-02 | Should converting ask before moving the number? | No — it moves automatically. The confirm existed only to protect the bin label, and `binLabelNumber` covers that now | 2026-08-21 | `binLabelNumber`, `requoteBeingConverted` | Standing |
| CN-03 | Does a re-quote keep the old number? | Held only if feet stay below 260 with the addition — but the old number must stay findable either way | 2026-08-18 | `whBinNumberFor` / `binLabelNumber` | Standing |
| CN-04 | Does Schedule ever touch customer numbers? | No. Numbers return to the pool in Customer Numbers, driven by customer status. Schedule is routing only | 2026-08-09 | routes-dashboard-plan.md | Standing |

## Quotes and re-quotes

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| QT-01 | Delete the customer and let the re-quote convert them back? | No — re-quotes get their own folder, and converting one *updates* | 2026-08-19 | `quoteFolder` | Standing |
| QT-02 | How many kinds of re-quote, and who says which? | Three, stated not guessed: addition to house / change of address / price only | 2026-08-21 | `askRequoteKind`, `requoteKind` | Standing |
| QT-03 | Price-only re-quote — does the warehouse do anything? | Nothing. Same house, same lights, same feet. It offers a box to explain the price change | 2026-08-21 | `requoteBuildChoice` | Standing |
| QT-04 | Applying a re-quote — one press or two? | One. "after I fill everything out I just want to convert them" | 2026-08-21 | `applyRequote(applyNow)` | Standing |
| QT-05 | What does the card say for an existing customer? | **Apply Re-Quote**, not Convert to Customer — "its converting them rather than updating them" | 2026-08-21 | `showConvertQuoteChoice` | Standing |
| QT-06 | Can the office mark a quote approved without emailing it? | Yes — that *is* the override. Taken back if the answer is later changed | 2026-08-21 | `approvedByOffice` | Standing |
| QT-07 | What does the popup ask the warehouse after a re-quote? | Recycle old & build new / build the add-on (footage **typed**, not calculated) / nothing. The add-on is always offered | 2026-08-21 | `requoteBuildChoice`, `houseBundleNeed` | Standing |
| QT-08 | ~~When is the add-on option offered?~~ | ~~Only when the sum comes out — known old footage and a bigger new one~~ | 2026-08-20 | — | Superseded → QT-07 |
| QT-09 | Does deleting a re-quote delete the customer? | No — the quote only, and the message names which of the two is going | 2026-08-20 | `attachDeleteHandlers` | Standing |
| QT-10 | Does a re-quote carry colours onto a customer who has none? | Yes. "Ashley and Rachel should have lights in warehouse so we can build them" | 2026-08-21 | `showApplyRequoteChoice` | Standing |
| QT-11 | Does the measure tool save feet as well as price? | Both, in one press. "I need no guessing I need feet to be correct" | 2026-08-25 | `rmCommitPayload` | Standing |
| QT-12 | Does the difficulty grade save when it's set? | Yes, automatically on change — not as a passenger on a commit button | 2026-08-25 | `#rmDifficulty` listener | Standing |
| QT-13 | Does the satellite alignment have to be redone per house? | No — it belongs to the photograph, remembered per area, inherited within a mile, and says on screen when it was inherited | 2026-08-25 | `settings/measureAlign` | Standing |
| QT-14 | Sides of the house — four names or a count? | A count, 1–4, so it matches the sheet. Front/left/right/back was a guess nobody could confirm | 2026-08-19 | `houseSideCount` | Standing |
| QT-15 | Are sides a second price input? | No — only measured feet sets the price. Sides raise a re-quote because the *footage* changes | 2026-08-21 | `docs/what-we-can-record.md` | Closed |
| QT-16 | Nothing changed on a re-quote — is that a valid answer? | Yes, and it must not be a dead end. "to the system it looks like nothing changes" | 2026-08-21 | `requoteBeingConverted` | Standing |
| QT-17 | Re-quote approval — how does the customer answer? | Three buttons: fill out a fresh form / change one thing in the portal / keep everything. The fresh form pre-fills from file, omits gate code and house notes, charges no portal change fee, sets no 48-hour lock | (chat) | not in repo yet | Decided — not built |
| QT-18 | Can the quote link sit behind her own words instead of printing the whole address? | **In an email, yes** — `{{link:See your home and approve here}}`, her words visible and the link behind them. **In a text, no**: SMS is plain characters, there is no such thing as a link behind a word, so the address stays visible — the words survive and the link goes on its own line underneath | 2026-08-26 | `applyQuoteLinkLabel` + `applyQuoteLinkLabelServer`, run-all.js Suite 279 | Standing |

## RSVP and season status

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| RS-01 | Does approving a quote count as yes to the season, even over a recorded "no"? | Yes — "go with option 2", asked directly and told the trade | 2026-08-22 | `seasonYesUpdates` | Standing |
| RS-02 | ~~Does approving override a recorded no?~~ | ~~No — a recorded "no" is a deliberate answer and one inferred from a price should not outrank it~~ | 2026-08-19 | kept as the argument against | Superseded → RS-01 |
| RS-03 | Does a later "no" still win? | Yes. Approving is one more way to say yes, not a lock. She asked for that specifically | 2026-08-22 | `seasonYesUpdates` | Standing |
| RS-04 | Does approving clear a Maybe Next Year badge? | Yes — "we shouldn't have to clear a badge to get somebody updated" | 2026-08-22 | `maybeNextYear` clear | Standing |
| RS-05 | Does "Back Next Year" recycle? | No. Never sets `needsLightRecycle`; it is its own status value, not a flavour of "no" | 2026-08-14 | `isOutForSeason`, `season-state.test.js` | Standing |
| RS-06 | Is there a tag for never-asked vs asked-and-silent? | Yes — a third tag, **Unanswered**, distinct from blank. Everyone moves to Unanswered right before the RSVP goes out | 2026-08-20 | `rsvpStatusLabel` — the one place a status is named | Standing |
| RS-07 | Does an RSVP go to somebody who has never had lights? | No — choosing an RSVP template sets the audience to Returning by itself. A default, not a lock | 2026-08-19 | `etTemplateIsRsvp` | Standing |
| RS-08 | Existing member approves — form, or portal? | Ask "do you want anything changed?" Yes → straight into the portal. No → a short message. A new member not yet converted still gets the form | 2026-08-19 | `alreadyMember` (functions/index.js) | Standing |
| RS-09 | Can the season be switched to answered-Yes-only before the RSVP is marked sent? | It must refuse. That guard is the one thing between one click and an empty season | 2026-08-25 | manual test 215 | Standing |
| RS-11 | How many days before install should a confirmation go out? | The question does not apply — **there is no pre-install confirmation.** It is the RSVP email, sent once at the start of the season: "This is for emails we don't have twillo and this would be for RSVP emails." Earlier than any N-days answer, and better, because it lands before anything is built | 2026-08-21 | Q-005; Automation Emails | Standing |
| RS-12 | What happens to a job whose confirmation comes back disputed? | **There is no disputed state.** The RSVP takes exactly three answers and `portalRsvp` rejects anything else. ⚠ A catch-all "something is wrong" reply was considered and **rejected — do not rebuild**: an answer that sometimes means *don't come* and sometimes means *my colours are wrong* is how a crew skips a house that was fine. A problem is a phone call; a wrong detail is the portal | 2026-08-21 | Q-006; R-005 retired | Closed |
| RS-13 | Does an assumed yes count as a reply? | **No.** "They need a reply either through email or approving through the button. We should be able to approve for them in costumers as well." Converting a quote writes `yes` with no `rsvpRespondedAt` — the office knowing they want lights, nobody having asked them about this season. All four routes stamp the date, including the office answering on their behalf | 2026-08-22 | Q-010b; `isOutForSeason` confirmed-only branch | Standing |
| RS-14 | What counts for the season once RSVPs are live? | "straight yes is the only thing to count for RSVP for the season." ⚠ The switch exists and **must not be flipped yet** — no RSVP has gone out, so it would put nearly everybody out of the season. *When* to flip it is still open as Q-010a | 2026-08-21 | Q-010; `SEASON_ELIGIBILITY` | Standing |
| RS-10 | The three RSVP answers, and what each does | **No** → records immediately, Cancel tab with an optional reason box, triggers `needsLightRecycle`. **Back Next Year** → homepage, "We look forward to seeing you next year!", no recycle logic, separate status. **Yes** → "Do you want changes?" → yes: portal logged in; no: thank-you message, then stops | (chat) | not in repo yet | Decided — not built |

## Schedule and routes

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| SCH-01 | Is the day or the town the unit? | The day. Each working day the free crews go to the towns with the most houses still waiting, recounted before the next day | 2026-08-17 | `planNewCrewDays`, Suite 47 | Standing |
| SCH-02 | How many towns can a crew have? | One dominant town plus at most one genuinely nearby — and the rule belongs to the **crew**, not the day | 2026-08-20 | `MAX_TOWNS_PER_CREW`, `townsAreNeighbours` | Standing |
| SCH-03 | Top up from the nearest town, or the most urgent? | Most urgent | 2026-08-17 | `fillableCount` | Standing |
| SCH-04 | What is the priority order? | New hangs outrank everything, then October, then a named day, then no preference, then November | 2026-08-17 | `houseInstallPriority` | Standing |
| SCH-05 | Is a named day urgent? | No — a named day is a **wait**, not a hurry. It is a floor: not before, and from there they take their turn, ahead of the people who don't mind | 2026-08-19/20 | `houseInstallPriority` = 2 | Standing |
| SCH-06 | Can anyone be hung before the month they asked for? | "under no circumstance." Enforced on the saved plan, not just at build time | 2026-08-17 | `houseAllowedFrom` | Standing |
| SCH-07 | Is October a deadline? | Yes — everyone who asked for October is done in October; November only if there is literally no other way, and then 1 November | 2026-08-18 | `houseDeadline` | Standing |
| SCH-08 | Thanksgiving? | Nobody works Thanksgiving Day, and Thanksgiving-labelled houses go as close to it as possible. The date is computed from the year, never written down | 2026-08-18 | `isWorkingDay` | Standing |
| SCH-09 | How big is a day? | 8 or fewer = one man. 9–19 = one crew. 20+ = two crews. **Eight is hers, not a formula** | 2026-08-20 | `ONE_MAN_MAX_HOUSES` | Standing |
| SCH-10 | Should the crew split be evened? | Yes, but only back to the cap — 19/21 becomes 20/20, 30/4 stays lopsided rather than breaking the cap | 2026-08-20 | `dayCrewHouses` | Standing |
| SCH-11 | Tidy the tail by filling one-man days to 15? | No — rejected after two attempts were built and shown. Prioritise every day having 40 over the ending days having 15; one-man days recalculate into crews | 2026-08-20 | `wastedDay` | Closed |
| SCH-12 | The dribble at the end — leave it or sweep it? | Sweep it up. But nobody is ever moved *later* than the day they already had, and a finished house never moves | 2026-08-18 | `packTailCrewDays` | Standing |
| SCH-13 | Which towns count as "close"? | No more than two per town, and actually close — "we dont want every city bordering each other" | 2026-08-20 | `DEFAULT_NEARBY_TOWNS` | Standing |
| SCH-14 | Do one-man installs get their own tab? | Yes, and it stays in sync as the season moves | 2026-08-20 | `oneManDays` | Standing |
| SCH-15 | When does a pinned day hold? | Only if the day falls within the next two business days. The pin is ignored, never deleted, and starts holding again on its own | 2026-08-20 | `effectivePin` | Standing |
| SCH-16 | Does ticking a stop on Schedule mark the customer complete? | Yes — one stop marks that customer, not the whole day. And it can trigger billing | 2026-08-21 | `hlxMarkJobDone` | Standing |
| SCH-17 | Does marking a route complete mean the takedown is done? | No. Install, takedown and fix are independent everywhere; nothing nests under anything | 2026-08-21 | `hlxMarkJobDone` | Standing |
| SCH-18 | Where does the route generator live? | In Schedule, and one button recalculates everything — two routes, one per crew, generated automatically | 2026-08-20 | `generateDayRoutes` | Standing |
| SCH-19 | Does the plan learn about customers added elsewhere? | Yes — the sync adds people it has never heard of, and pulls changes from all customers periodically | 2026-08-17/20 | `customersMissingFromSeason` | Standing |
| SCH-20 | Keep the New Members tab in Schedule? | No — removed. It answered a question only a re-import could raise | 2026-08-20 | pane removed, `syncTabs` | Closed |
| SCH-21 | Keep the Calendar tab? | No — confirmed delete. Schedule's day sidebar is the calendar | 2026-08-09 | routes-dashboard-plan.md | Closed |
| SCH-23 | Who sets "Before/After Thanksgiving", and where? | "that should only be assigned by admins in admin portal through customers and then that should go into reassign for that member." Before Thanksgiving is its own key (`prethx`), not swallowed by the November prefix | 2026-08-21 | Q-011; `prefKey` | Standing |
| SCH-24 | A house is past the day it asked to beat and no earlier day has room — move it or leave it? | **Leave it where it is and report it**, matching what the too-early branch has always done. The message says which way they are stuck; it used to say "no later day has room" to everybody, which is backwards for a missed deadline | 2026-08-21 | Q-011; `enforceInstallTiming` | Standing |
| SCH-22 | Does Schedule run recycle or number logic? | No. Marking a takedown done means the lights are physically off, nothing more | 2026-08-09 | routes-dashboard-plan.md | Standing |

## Printing

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| PR-01 | What does Print Today print? | Three papers: the warehouse list for **two days from now**, plus both crew lists for the next working day, each on its own page | 2026-08-20 | `printToday` | Standing |
| PR-02 | Does the Printing tab replace the per-day print buttons? | No — "keep that their." The tab is the morning routine, not a replacement | 2026-08-20 | `printDaySheet`, `printCrewSheet` | Standing |
| PR-03 | Is the crew portal in use this season? | No — "were not using the employee portal this year... we are only printing on schedules and warehouse." `employee.html` stays in the repo, dormant | 2026-08-21 | `printCrewColumns`, `fix-sheet.test.js` | Standing |
| PR-04 | Does the crew get told what's wrong on a fix? | Yes — a **What's wrong** column, and the fault photo in its own block under its own heading, never merged with the new-hangs photos | 2026-08-25 | `printCrewColumns` | Standing |
| PR-05 | A flagged house with no note — blank or something? | "?" — never blank. Blank reads as nothing-wrong-here on a row that is on the sheet *because* something is | 2026-08-25 | `printYesNo` | Standing |
| PR-06 | Do new house photos print on route schedules? | Yes | (chat) | built for crew sheets; missing from Print Whole Plan | Standing |

## The master sheet and the importers

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| SH-01 | Which workbook is the master? | `2026 Client List.xlsx` — "use the new one." The old one's phone column is detached from its rows and has been renamed so it can't be picked | 2026-08-19 | CLAUDE.md | Standing |
| SH-02 | Is Bulk Updates still the tool to reach for? | No — retired in practice. "we should no longer use bulk so this is no longer a concern." The path is Use my master sheet → Compare → Sync | 2026-08-21 | `rbApplyTickedAdds` + ledger | Standing |
| SH-03 | How many rows per batch? | A dial she turns, not a settled number — 250 → 150 → 50 in one afternoon. It remembers its place across a reload | 2026-08-17 | `BULK_CHUNK_SIZE` | Standing |
| SH-04 | Does the sheet flip names by itself? | Yes — "excel is last first but the website is first last." A fresh paste ticks the box itself and shows three names as they will be saved | 2026-08-17 | `rbFlipNames` | Standing |
| SH-05 | One sync button, or one per row? | One. Anything she doesn't want synced she fixes by hand first | 2026-08-19 | `rbRenderLedger` | Standing |
| SH-06 | What sorts to the top of the comparison? | Things needing a manual decision that would fail to sync, then exists-on-one-side-only, then address, then price | 2026-08-19 | `RB_FIELD_RANK` | Standing |
| SH-07 | Who may the comparison offer as a customer? | Not a row with no name, and not a row that is sheet-only bookkeeping. The count stays so nothing silently vanishes | 2026-08-19 | `rbCollectMissingCustomers` | Standing |
| SH-08 | Are new quotes written back into the sheet? | Yes — into the first open row of **that exact file**, never a re-downloaded copy | 2026-08-19 | `hlxAppendRowsToSheet` | Standing |
| SH-09 | What is the `$$` column? | The standard price with no fees. "that will be website only" — Set Up Fee is left blank by us | 2026-08-19 | `rbMiscParse` | Standing |
| SH-10 | What is Up Plug? | The eaves question. "?" is not a no — blank leaves the record alone | 2026-08-19 | `useEaves` mapping | Standing |
| SH-11 | Where does outlet information live? | Sometimes in Notes — and when it does it goes to the outlet preference in All Customers | 2026-08-19 | `rbOutletFromNote` | Standing |
| SH-12 | Where do gate codes appear, and in what format? | Misc **and** Notes, in many formats — including the bare `#0754` the office actually types. "make sure you format it in many formats" | 2026-08-19/20 | `rbGateCodeFromText` | Standing |
| SH-13 | "paid" written anywhere — note or tag? | The **tag** changes, and the season in the cell is deliberately ignored | 2026-08-20 | `rbRowSaysPrepaid` | Standing |
| SH-14 | Is the customer list one sheet? | Four. Confirmed, Color Change, Contact 2027 and Recycle are their own **tabs**, not columns — and a customer in two of them is not a second customer | 2026-08-20 | `hlxWorkbookRowsAllSheets`, `HLX_STATE_TABS` | Standing |
| SH-15 | Should the master-sheet choice follow her between computers? | The **choice** does — it is information, written to `settings/masterSheet`. The browser's **permission** cannot, and needs one press per machine | 2026-08-19 | `settings/masterSheet` | Standing |
| SH-16 | A payer given as an email instead of a name? | Kept as `billToEmail` and preferred — an address is exact where a name is a guess | 2026-08-19 | `rbResolveBillTo` | Standing |

## Duplicates and test records

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| DUP-01 | Merge duplicates, or delete them? | "if you can make it so they rather merge more than just delete" — by name and CU# | 2026-08-18 | `findMergeableCustomers` | Standing |
| DUP-02 | When are two records the same person? | "two different names are never duplicates unless one is surname firstname and the other is firstname surname." Griner Lauren and Lauren Griner are one; Chafffetz and Chaffetz are not | 2026-08-18 | `dupNormName` sorts the words | Standing |
| DUP-03 | Group duplicates by phone, email or street as well as name? | **Rejected — do not rebuild.** Measured on the real book: 17 phone numbers are held by two people and 14 of those are genuine households | 2026-08-19 | CLAUDE.md | Closed |
| DUP-04 | Should sync tick spare copies for deletion by default? | Yes — she asked twice. Safe because of DUP-02, and because merge happens before delete | 2026-08-19 | `mergeFieldsFrom` | Standing |
| DUP-05 | What do you call a website record the sheet doesn't have? | "instead of all those words where it says not on the sheet just call it duplicate" | 2026-08-19 | `dupNormName` | Standing |
| DUP-06 | Should the test customer use a fake address? | No — a real one, 209 S 850 W, Lehi. A fake address can't be geocoded, so a test record could never be routed or mapped, which is most of what it's for | 2026-08-21 | `isTestRecordData` | Standing |
| DUP-07 | Can test records be removed in one press? | Yes — customers, quotes, invoices, routes, schedule, warehouse and the recycle list, with the number put back | 2026-08-21 | `testSweepFind` / `testSweepDelete` | Standing |

## The inbox

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| MSG-01 | What does the number beside a folder count? | Unread only. "I only want the number to show how many are unread" | 2026-08-25 | `folderUnread` | Standing |
| MSG-02 | Should the inbox look like Gmail? | Yes — "I want this to be very similar to gmail layout." Closed folder rolls its children up, open one does not; a zero draws as nothing | 2026-08-25 | `renderFolderSidebar`, `folderUnread`, Suite 273 | Standing |
| MSG-03 | Does Mark Responded also mark it read? | Yes. One direction only — Mark Awaiting does **not** put it back to unread | 2026-08-25 | `msgBulkApply` | Standing |
| MSG-04 | Replace drag-and-drop with tick-and-move? | No — add it. Drag and right-click are kept, because somebody already used to dragging must not lose it | 2026-08-25 | `msgMoveTo` | Standing |
| MSG-05 | Can the Billing, Quotes and Text Messages folders be renamed or deleted? | No — other parts of the app look them up by name | (chat) | not in repo yet | Standing |

## Health-check notices

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| HC-01 | What does **Deny** mean on a health-check notice? | Not until the data changes — the exception is scoped to a fingerprint and comes back on its own when the values move. **And it is per member:** "I should be able to choose what member I'm denying for and approve for all other members if we run into that situation." ⚠ So the decision cannot live on the notice — `messages` caps at 5,000 characters — it is keyed on check + member + fingerprint | 2026-08-21 | Q-008; P-002 | Decided — not built |
| HC-02 | Which health checks may raise a notice? | All of them. "I want to be able to approve or deny it. But after approve it can auto write." Approve means the finding is real, and where a check has an auto-fix, approving RUNS it. ⚠ That makes a notice a bulk write path — one click on "43 invoices have drifted" is 43 money writes — so the notice must carry its own preview, R-007's cap and R-008's log | 2026-08-21 | Q-009; P-002 | Decided — not built |

## Customer-facing options

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| OPT-01 | What is the real customer-facing option set? | The fourteen in `js/options.js`, corrected by her from a placeholder that had seven invented field names in it: measuredFeet, lightsDescription, wireColor, outletTimer, useEaves, specificOutlet, gateCode, houseSides, installPreference, notes, oneTimeNote, wantsMailedInvoice, numberOfBins, difficulty | 2026-08-21 | Q-007; `options-audit.test.js` frozen AGREED map | Standing |

## Process, testing and delivery

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| PROC-01 | How much manual testing should there be? | As little as possible — "it should minimize since you are testing too." The checklist is only for what a human or a live environment must verify | 2026-08-17 | `MANUAL_ONLY_IDS` | Standing |
| PROC-02 | Bump a test's version to force a retest of something the suite covers? | No. The suite passing **is** the sign-off | 2026-08-17 | CLAUDE.md §0 | Standing |
| PROC-03 | Where does new coverage go? | The automated suite — not a new manual row, unless it genuinely can't be automated (a real charge, a real email, a physical crew step, a print check) | 2026-08-17 | CLAUDE.md §0 | Standing |
| PROC-04 | Do tests ship with the change? | Yes, in the same commit. She asked for this rule by name | 2026-08-14 | CLAUDE.md §9.9 | Standing |
| PROC-05 | Canary / percentage rollout with automatic rollback? | **Considered and rejected, with her agreement. Do not build it and do not suggest it again without new information** | 2026-08-14 | CLAUDE.md §9.10 | Closed |
| PROC-06 | Add `data-testid` everywhere in one sweep? | No — as you go. A mass edit of the file is risk without benefit | 2026-08-14 | CLAUDE.md §9 | Standing |
| PROC-07 | Repeat the approve/maybe/decline buttons when there are several photos? | No — "just one approved, Maybe later, Decline." She read the doubled set as a mistake. Do not reintroduce it as a fix for a long email | 2026-08-17 | Suite 33 | Closed |
| PROC-08 | ~~Should the buttons be repeated below a stack of photos?~~ | ~~Yes, so Approve is never far down a phone~~ | 2026-08-13 | `repeatQuoteButtonsServer`, removed | Superseded → PROC-07 |
| PROC-09 | Remove an existing feature while doing something else? | No — features don't get removed unless she asks. Archive over delete | (standing) | project rules | Standing |
| PROC-10 | Write code straight away, or explain first? | Explain first — the feature, the files, the cross-part impact — and wait for the go-ahead. Mockups before major UI changes | (standing) | project rules | Standing |
| PROC-11 | Deliver snippets or whole files? | Whole files, through the file system — only the files she needs to upload | (standing) | project rules | Standing |
| PROC-13 | Is "write the ruling down" an active rule or a proposal? | Active — **R-023**, `read` + `code`, tier 5. Filing it as proposed was wrong: R-005 was retired because the state it governed did not exist, not because it was unenforceable, and this rulebook already has a tier for rules that can only be honoured | 2026-08-26 | `docs/RULES.md` R-023 + amendment log | Standing |
| PROC-12 | What does a test failure have to say? | Enough to be understood from the pasted text alone — "failures should read legibility so you can understand it when we ask you questions about failures." The file, the line, which row, **what that row says**, and the fix. Grouped by row, not one line per check | 2026-08-26 | `questions-map.test.js` reporter, 13 sabotages | Standing |

## Fixes

| # | Question | Her answer | Decided | Where it's proved | Status |
|---|---|---|---|---|---|
| FIX-01 | Who schedules fixes this season? | The office, not the crew | (chat) | not in repo yet | Standing |
| FIX-02 | How does a new fix surface? | A System inbox note with a link to the customer card. The photo can come from either side. Park-then-destroy with an undo; the note disappears when it's done; the house photo is never touched | (chat) | not in repo yet | Decided — not built |

---

## Open questions live somewhere else

⚠ **Do not start a second list here.** `docs/open-questions.md` already owns open
questions, as `Q-` entries, under R-020 — and its own header already says every answer
becomes a map entry so it is never asked twice. **This file is that destination.**

So the loop is: an `intent` question is raised as a `Q-` entry → Addie answers it → the
`Q-` entry's **Resulting map change** line names the row it created here → the row here
carries the answer. `questions-map.test.js` checks both ends of that link.

Two things are outstanding and are *not* `Q-` entries yet, because neither has been
raised as one. If either needs a decision from Addie rather than a plan from Claude, it
should be raised there first:

- The `ROUTES` router on HEAD's `index.html` — wanted, or dropped? Blocks uploading the
  restored `e67dc8b` files.
- The two retired importers' add branches and `needsLightBuild` — plan written, approval
  pending before any file changes.

---

## What was deliberately left out

Kept out on purpose, so nobody adds them back thinking they were missed:

- **Facts about the code** — the 260 ft bin cutoff, phone digits as the invoice key, which
  function writes what. Those live in `system-map.md` and are derivable by reading the code.
- **Technical constraints that were never a choice** — a carousel is impossible in email,
  EmailJS returning OK is not delivery, the Firestore emulator can't be downloaded in the
  sandbox. Those live in `CLAUDE.md` with their reasoning.
- **Conventions** — branch names, deploy order, patch discipline. `CLAUDE.md` owns those.

If one of those turns into a judgement call — she picks between two technically valid
answers — *that* becomes a row here.

Last updated: 2026-08-26
