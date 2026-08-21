# Option registry — draft for review

**Status: DRAFT, revised 2026-08-21 with Addie's answers. Not active. Nothing
imports this, and `js/options.js` is untouched.**

Every row was derived from the code; the destinations in §2 are Addie's answers.
§5 is settled. §7 carries one thing that must not be done yet.

---

## 1. Where this came from

| Source | What it settles |
|---|---|
| `quoteDetailForm` submit handler, `index.html:2702` | **the customer-facing list** — what a new customer is actually asked for |
| `PORTAL_WRITE_FIELDS` / `PORTAL_READ_FIELDS`, `functions/index.js:554` | what a member may change and see later |
| `PRINT_COLUMNS`, `admin.html` | what actually reaches paper |
| Add Customer form (`addCust*` ids) | what the office sets that the customer never sees |

---

## 2. The registry

**⚠ EIGHT DESTINATIONS, NOT FIVE.** `js/options.js` ships a `CONSUMERS` list of
five (`quote`, `confirmation`, `crewSheet`, `pullList`, `invoice`) and R-003
names six, adding the customer record. Addie's answers name two more that are
neither: **Routes** and **Schedule**, which are genuinely separate surfaces —
Schedule is the season laid out day by day (`routeSchedule/plan`), Routes is the
crew's driving order for one day (`scheduledRoutes`). `CONSUMERS` has to grow to
eight, and `audit()` with it.

| # | Option | Field | Price? | Quote | Conf | Cust | Crew | Pull | Route | Sched | Inv |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Measured feet | `measuredFeet` | **YES** | ✓ | **✓ new** | ✓ | – | ✓ | – | – | ✓ |
| 2 | Light colours / pattern | `lightsDescription`, `lightColors` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 3 | Wire colour | `wireColor` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 4 | Timer | `outletTimer` | no | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| 5 | Plugs / eaves | `useEaves` | no | ✓ | – | ✓ | ✓ | – | – | – | – |
| 6 | Which outlet | `specificOutlet`, `specificOutletNotes` | no | ✓ | ✓ | ✓ | **✓ new** | – | – | – | – |
| 7 | Gate code | `gateCode` | no | ✓ | ✓ | ✓ | **✓ new** | – | – | – | – |
| 8 | Sides of the house | `houseSides` | no¹ | ✓ | ✓ | ✓ | **✓ new** | – | **✓ new** | **✓ new** | – |
| 9 | Install timing | `installPreference` | no | ✓ | ✓ | ✓ | – | – | – | ✓ | – |
| 10 | Notes | `notes` | no | ✓ | – | ✓ | ✓ | – | **✓ new** | **✓ new** | – |
| 11 | One-time note | `oneTimeNote` | no | – | – | ✓ | **✓ new** | – | **✓ new** | **✓ new** | – |
| 12 | Mailed invoice | `wantsMailedInvoice` | no | ✓ | – | ✓ | – | – | – | – | **✓ new** |
| 13 | Bins | `numberOfBins` | no | – | – | **✓ new** | – | ✓ | **✓ new** | **✓ new** | – |
| 14 | Difficulty | `difficulty` | no | – | – | ✓ | – | – | **✓ new** | **✓ new** | – |

**✓ new** = a destination Addie added that the option does not reach today.
**–** = deliberately not there.

¹ **Sides does not have its own price.** Changing it raises a re-quote because
the *footage* changes, and the footage is what is charged. Recorded explicitly so
nobody later adds a per-side surcharge: Addie, 2026-08-21 — *"Nothing but feet
should affect price."* ⚠ The comment at `functions/index.js:1066` says changing
sides "changes the PRICE", which is true only through feet. Do not read it as a
second price input.

---

## 3. The crew rule

> *"Everything saved in crew should also print on the schedule sheet we print off."*
> — Addie, 2026-08-21

That is a general invariant, not a per-option answer, and it closes three of the
four holes in §4 by itself. Proposed as **P-003** in `docs/RULES.md`. It is
testable — the printed sheet's columns can be checked against what the crew
portal renders — so it can be `code`-enforced rather than remembered.

---

## 4. The four holes, and where they now stand

| Hole | Status |
|---|---|
| **a.** Gate code shows in the crew portal, never prints | **Closed by the crew rule.** Row 7 gains Crew. |
| **b.** `useEaves` prints, but is absent from the crew portal | **Still open** — this one runs the *other* way, so the crew rule does not reach it. The printed sheet is right; the portal is missing it. |
| **c.** Which-outlet instructions never print | **Closed by the crew rule.** Row 6 gains Crew. |
| **d.** Side count reaches neither crew surface | **Closed explicitly.** Addie: sides go to Routes and Schedule, and the crew rule carries it to paper. |

---

## 5. The confirmation — settled

**① It is the RSVP email, not a new message, and it goes by EMAIL not SMS.**
Addie, 2026-08-21: *"This is for emails we don't have twillo and this would be
for RSVP emails."*

⚠ **Plan §4.2 is wrong on both counts.** It says *"Send `confirmationText(customer)`
via the existing Twilio path, N days before the scheduled install date."* The
Twilio code exists (`sendSms`, `twilioSendRaw`) but the service is not in use, and
the confirmation is not a separate pre-install message — it is the RSVP email
that already goes out at the start of the season through Automation Emails.

Two consequences, both good:

- **Phase 2 shrinks a lot.** There is no new send path, no new template system and
  no new scheduler. The RSVP email exists, has a token flow, and already carries
  `{{houses_block}}`. The option list becomes a block inside it.
- **Q-005 is moot.** "How many days before install?" was the wrong question — the
  RSVP goes out once at season start, before anything is built, which is *earlier*
  and therefore better: there is still time to change everything.

⚠ The one thing it does not do is catch a change made *after* the RSVP. A
pre-install confirmation would. Recorded rather than argued — Addie decided, and
the RSVP catches far more for far less work.

**② Plugs / eaves comes off the confirmation entirely.**
Addie: *"Okay lets get rid of eaves if it will cause more confusion."*
Row 5's `Conf` is now `–`. **No R-002 exception is needed** — the rule is about
an option that *is* on an artifact rendering `none` rather than a blank, not about
which options appear at all. Cleanest possible resolution.

---

## 6. Answered

- **Anything sold that has no row?** No — the list is complete. The placeholder
  `js/options.js` guessed at wreaths and walkways; neither exists in this business.
- **Anything but feet affecting price?** No. Feet only.
- **Confirmation list:** measured feet + price, light colours, wire colour, timer,
  which outlet, gate code, sides, install timing. Not eaves, not notes, not the
  internal rows.

---

## 7. ⚠ "Straight yes only" — already built, and DO NOT FLIP IT YET

Addie, 2026-08-21: *"straight yes is the only thing to count for RSVP for the season."*

**That switch already exists**, left by an earlier session for exactly this moment:

```js
const SEASON_ELIGIBILITY = 'all-but-maybe-next-year';   // or 'confirmed-only'
```

`isOutForSeason` already implements the `confirmed-only` branch, and `run-all.js`
already tests BOTH modes so the branch cannot rot before it is switched on. The
comment above it records the earlier instruction it was built for: *"for now we
want anyone who isnt maybe next year to be on the list but we will change it to
only confirmed on the scheduled list eventually."*

**⚠ FLIPPING IT TODAY EMPTIES THE SEASON.** Nobody has been sent an RSVP yet, so
almost every customer is unanswered, and `confirmed-only` puts every one of them
out. No routes, no builds, no installs. The existing comment says it in as many
words: flip it *"when the RSVP email is live and everyone has actually been
asked."* The order is: send the RSVP → let people answer → then flip.

**⚠ AND `confirmed-only` IS NOT CURRENTLY A *STRAIGHT* YES.** It tests
`rsvpStatus === 'yes'` and nothing else. But converting a quote writes
`rsvpStatus: 'yes'` at creation **with no `rsvpRespondedAt`** — the office knows
they want lights; nobody has asked them about *this season*. So a converted
customer would count as confirmed without ever answering.

The stricter test already exists a few thousand lines away, in the Excel "Yes"
tab: `if(said === 'yes' && d.rsvpRespondedAt) return true;` — with a comment
saying precisely why the timestamp is needed. **Two places decide "did they
really say yes" and they disagree.** If "straight yes" is meant literally,
`isOutForSeason` needs the same `&& rsvpRespondedAt`.

Raised as **Q-010**. Nothing has been changed.

---

*Derived 2026-08-21, revised the same day with Addie's answers. `js/options.js`
still holds its original placeholder set and is still imported by nothing.*
