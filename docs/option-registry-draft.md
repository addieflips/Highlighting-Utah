# Option registry — draft for review

**Status: DRAFT, revised 2026-08-21 with Addie's answers. Not active. Nothing
imports this, and `js/options.js` is untouched.**

Every row was derived from the code; the destinations in §2 are Addie's answers.
Two things still need her — they are in §5, and one of them is a rule conflict.

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
| 5 | Plugs / eaves | `useEaves` | no | ✓ | **cond. ⚠ §5** | ✓ | ✓ | – | – | – | – |
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

## 5. Settled, and one wrinkle left

**① R-004 upheld — the confirmation carries a price/footage line.**
Addie, 2026-08-21: *"lets do put a price/footage line on the confirmation."*
So R-004 stands as written, `measuredFeet` gains `confirmation`, and `audit()`
passes. No amendment needed. The customer sees the footage and the charge before
the truck arrives, which is the whole of R-004's reasoning.

**② Plugs / eaves goes on — but only when they said no. This collides with R-002.**
Addie: *"We can put eaves on there if they said no to eaves."*

The intent is clear and sensible: "yes, use the eaves" is the ordinary case and
printing it for everyone is noise; "no" is the exception the crew has to respect.

⚠ But R-002 is tier 1 and says an option with no value renders `none`, **never an
omitted line** — because silence and "they didn't want it" must not look alike.
Hiding the line for anyone who is not a "no" makes three different states
identical on the page, and the real data says that matters here. The Up Plug
column on the master sheet holds **112 yes, 98 "?", 61 no, 3 y** — so roughly
*ninety-eight customers have never actually answered this question.* Under a
show-only-if-no rule, those 98 look exactly like the 112 who said yes, and the
one surface that could have got them to answer says nothing.

CLAUDE.md already settled the same point for the importer: *"'?' is not a no:
blank leaves the record alone, which is the honest answer to a question mark."*

**Proposal — gives Addie what she asked for without losing the 98:**

| Their answer | Confirmation line |
|---|---|
| No | `Plugs / eaves: no — we will not use the eaves outlet` |
| Blank / "?" | `Plugs / eaves: not answered — tell us in your portal` |
| Yes | *omitted* |

Only a clear **yes** is hidden, and a yes is the case where absence is genuinely
unambiguous, because it is the default we would act on anyway.

⚠ This still needs an **explicit R-002 exception logged**, because one option is
now conditionally omitted where the rule says never. It also means `consumers`
cannot stay a flat list for this row alone: the option declares `confirmation`
(so R-003 and R-004 still see it) and carries a `confirmationWhen` predicate the
renderer consults. `audit()` is unaffected.

**Needs Addie: is the middle row right?** If she wants a strict
show-only-when-no, that is her call and R-002 gets the exception either way —
but the 98 unanswered stay unanswered, and nothing else in the system is going
to ask them.

## 6. Answered

- **Anything sold that has no row?** No — the list is complete. The placeholder
  `js/options.js` guessed at wreaths and walkways; neither exists in this
  business. They come out when this replaces it.
- **Anything but feet affecting price?** No. Feet only.

---

*Derived 2026-08-21, revised the same day with Addie's answers. `js/options.js`
still holds its original placeholder set and is still imported by nothing.*
