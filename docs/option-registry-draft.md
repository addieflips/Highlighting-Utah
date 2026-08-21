# Option registry — draft for review

**Status: DRAFT. Not active. Nothing imports this, and `js/options.js` is
untouched.** This exists to turn Q-007 from an essay into ten minutes of ticking.

Every row below was derived from the code, not invented. The `Evidence` column
says where each one actually lives today, so you can check any line I got wrong.
What I need from you is in **§4** — three questions, and the corrections you make
to the table.

Once this is signed off it becomes `js/options.js`, Phase 1 unblocks, and R-001
starts being enforceable.

---

## 1. Where this came from

Four sources, in descending order of authority:

| Source | What it settles |
|---|---|
| `quoteDetailForm` submit handler, `index.html:2702` | **the customer-facing list.** Exactly what a new customer is asked for after they approve a quote |
| `PORTAL_WRITE_FIELDS` / `PORTAL_READ_FIELDS`, `functions/index.js:554` | what a member may change and see later — already grouped by save-section |
| `PRINT_COLUMNS`, `admin.html` | what actually prints on the crew sheet and the build sheet |
| Add Customer form (`addCust*` ids) | what the office can set that the customer never sees |

The five consumers in the plan are `quote`, `confirmation`, `crewSheet`,
`pullList`, `invoice`. ⚠ **Four of those exist. `confirmation` does not** — the
confirmation text is Phase 2 and nothing sends one today. So that column is you
deciding what a future message should say, not me describing something live.

---

## 2. The draft registry

`Price?` = does this change what they are charged.
`Quote` = asked at quote time · `Conf` = should appear on the confirmation text
(Phase 2) · `Crew` = printed crew sheet · `Pull` = warehouse build sheet ·
`Inv` = an invoice line.

**✓** = it does today · **✗** = it does not today · **?** = my proposal, needs your call

| # | Option | Field | Type | Price? | Quote | Conf | Crew | Pull | Inv | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Measured feet | `measuredFeet` | measure (ft) | **YES** | ✓ | ? | ✗ | ✓ | ✓ | `perFootRate × feet`; also drives bins, bundles, number series |
| 2 | Light colours / pattern | `lightsDescription`, `lightColors` | text + list | no | ✓ | ? | ✗ | ✓ | ✗ | quote form; build sheet "Light color" |
| 3 | Wire colour | `wireColor` | choice | no | ✓ | ? | ✗ | ✓ | ✗ | build sheet "Wire color" |
| 4 | Timer | `outletTimer` | yes/no | no | ✓ | ? | ✓ | ✓ | ✗ | crew sheet "Timer"; build sheet "Timer" |
| 5 | Plugs / eaves | `useEaves` | yes/no | no | ✓ | ? | ✓ | ✗ | ✗ | crew sheet "Plugs / eaves". ⚠ **not in the crew portal** |
| 6 | Which outlet | `specificOutlet`, `specificOutletNotes` | yes/no + text | no | ✓ | ? | ✗ | ✗ | ✗ | ⚠ **crew portal only — never prints** |
| 7 | Gate code | `gateCode` | text | no | ✓ | ? | ✗ | ✗ | ✗ | ⚠ **crew portal only — never prints** |
| 8 | Sides of the house | `houseSides` / `houseSideCount` | count 1–4 | **YES** | ✓ | ? | ✗ | ✗ | ✗ | changing it raises a re-quote — `PORTAL_WRITE_FIELDS.sides` |
| 9 | Install timing | `installPreference` | choice | no | ✓ | ? | ✗ | ✗ | ✗ | drives the season plan, not a crew instruction |
| 10 | Permanent notes | `notes` | text | no | ✓ | ✗ | ✓ | ✗ | ✗ | crew sheet "Notes" |
| 11 | One-time note | `oneTimeNote` | text | no | ✗ | ✗ | ✗ | ✗ | ✗ | ⚠ **crew portal only — never prints** |
| 12 | Mailed invoice | `wantsMailedInvoice` | yes/no | no | ✓ | ? | ✗ | ✗ | ? | office-side billing preference |
| 13 | Bins | `numberOfBins` | count | no | ✗ | ✗ | ✗ | ✓ | ✗ | internal — derived from feet, never asked |
| 14 | Difficulty | `difficulty` | choice | no | ✗ | ✗ | ✗ | ✗ | ✗ | internal office rating. Shows in the crew *portal* (3 refs), never prints |

**Rows 13 and 14 are internal**, so R-003's exception applies — they legitimately
skip `quote`, `confirmation` and `invoice`. Everything else is customer-facing.

---

## 3. Four holes this surfaced

These fell out of building the table. All four are real; none is fixed.

**a. The gate code never prints.** It shows on the crew portal as a tag
(`employee.html:2729`) and nowhere else. A crew working off the printed sheet —
which is the whole point of the Printing tab's "Print Today" — arrives at a gated
house with no code.

**b. `useEaves` is the exact opposite.** It prints on the crew sheet and does
*not* appear in the crew portal at all (verified — the only "eave" matches in
`employee.html` are the word "leave"). So the two surfaces the same crew uses
each carry something the other is missing.

**c. Which-outlet instructions never print either.** `specificOutletNotes` holds
real install directions — "use lower outlet by door w/ timer" — and the printed
sheet has no column for them.

**d. Sides of the house reaches neither crew surface.** It changes the price and
raises a re-quote, and then the people doing the work are never told the number.
This may be fine — the bundle is already built to the footage — which is why it's
a question in §4 rather than a bug report.

⚠ Every one of these is invisible to the automated suite, and always would have
been. Nothing is broken: each field is written, stored and read. They are holes
between artifacts, which is exactly the class R-003 exists for and exactly what
generating the five artifacts from one list makes impossible.

---

## 4. What I need from you

**Q1 — Is this the right list?** Add anything sold today that has no row here.
That is Plan §12's blind spot: an option the software has no field for is
invisible to every detector in this document, permanently. It is the one thing I
cannot find by reading code.

**Q2 — Does anything besides feet and sides change the price?** I found only
those two. If a timer, extra wreaths, a second building or a hard-access house
carries a charge today, it is being priced by hand and no rule knows about it.

**Q3 — Fill in the `Conf` column.** What should the confirmation text list?
My proposal: rows 1–9 — everything the customer chose, including the ones that
currently print as nothing. R-002 says each renders `none` rather than being
omitted, so they can check the whole list at a glance. Rows 10–14 stay off it.

And on the four holes in §3: (a), (b) and (c) look like straightforward
omissions I would fix. (d) I would leave alone unless you say the crew needs it.

---

*Derived 2026-08-21. Supersedes nothing — `js/options.js` still holds its original
placeholder set and is still imported by nothing.*
