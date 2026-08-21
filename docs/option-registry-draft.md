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
| 1 | Measured feet | `measuredFeet` | **YES** | ✓ | ⚠ §5 | ✓ | – | ✓ | – | – | ✓ |
| 2 | Light colours / pattern | `lightsDescription`, `lightColors` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 3 | Wire colour | `wireColor` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 4 | Timer | `outletTimer` | no | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| 5 | Plugs / eaves | `useEaves` | no | ✓ | ⚠ §5 | ✓ | ✓ | – | – | – | – |
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

## 5. Two things still needed

**① R-004 vs the confirmation list — a real conflict, tier 1, `code`-enforced.**

Addie's confirmation list is: light colours, wire colour, which outlet, gate code,
sides, install timing, and timer. It contains **no price and no footage.**

R-004 says *"Anything the customer pays for must appear on the confirmation text"*,
and it is enforced by `audit()` — an option with `affectsPrice` and no
`confirmation` consumer **fails the build**. Measured feet is the only thing that
affects price. So the list as given makes `audit()` refuse on day one of Phase 1.

Two ways out, and it is Addie's call which:

- **add a price/footage line to the confirmation** — keeps R-004 as written, and
  the customer sees what they are being charged before the truck arrives; or
- **amend R-004** to "anything the customer pays for must be shown *before* they
  are billed", on the grounds that the quote already showed them the price and the
  confirmation is about *what we are installing*, not what it costs.

Both are defensible. The second is probably what she means — but R-004 is tier 1
and guessing at a tier-1 rule is exactly what this system exists to prevent.

**② Plugs / eaves is missing from the confirmation list.** Rows 2, 3, 4, 6, 7, 8
and 9 were named; `useEaves` was not. It is a customer preference like the
others, so this is likely an oversight rather than a decision — unless "which
outlet" is meant to cover it, in which case the two should probably be one
option rather than two.

---

## 6. Answered

- **Anything sold that has no row?** No — the list is complete. The placeholder
  `js/options.js` guessed at wreaths and walkways; neither exists in this
  business. They come out when this replaces it.
- **Anything but feet affecting price?** No. Feet only.

---

*Derived 2026-08-21, revised the same day with Addie's answers. `js/options.js`
still holds its original placeholder set and is still imported by nothing.*
