# Open questions

Format: one entry per question. Never delete — mark answered.
Every answered question becomes a map or registry entry, so it's never asked twice.

**intent** = only Addie can answer (business rules, policy, what should happen).
**factual** = resolvable by reading code, so it should never reach her. Resolve it.

Anything `open` that sits on a customer-facing data path escalates rather than
aging quietly. Every answer produces a map or registry change — if it doesn't,
the question was mis-scoped.

---

## Q-001 · factual · answered · 2026-08-21
Is there a third place money is computed?

**Answer: yes — and the parity test is not guarding what the plan assumes it guards.**

`money-parity.test.js` compares exactly two things, over 12 checks:
`computeInvoiceStatus` vs `computeInvoiceStatusServer` (the *status string*), and
`custInvoiceKey` vs `invoiceKeyFor` (the *invoice key*). It never compares the
**amount owed**. The amount is what gets charged, displayed and disputed, and it
is computed by hand at roughly a dozen sites across three files:

> **⚠ CORRECTED 2026-08-21.** This entry first said `balanceDueAmount()` "is
> called zero times — dead code". **That was wrong.** It has **12 call sites** in
> `admin.html`. The claim came from a malformed grep (`balanceOf(`, which does
> not match `balanceDueAmount(`) and it was not re-checked. The rest of the
> finding stands and is if anything sharper: the helper *is* the house style in
> admin, which makes the handful of places that bypass it, and the two other
> files that have never heard of it, the actual defect. `docs/RULES.md`'s
> amendment log carries the same correction.

| Where | What it computes | Guarded? |
|---|---|---|
| `admin.html:5459` `balanceDueAmount()` | the canonical formula, as a helper | **12 callers — the intended path, and it works** |
| `admin.html` ×3 (12885, 13131, 13207) | the balance, inlined instead of calling it | no |
| `admin.html` ×5 (13229, 13237, 18824, 27990, 34092) | gross, or gross-minus-credits, inlined | no |
| `functions/index.js:337` `paypalCreateOrder` | `balanceDue` — **the real card charge** | no |
| `functions/index.js` 112, 413, 2401, 2473 | gross/owed, inlined | no |
| `index.html:3235` (member portal) | `totalDue`, shown to the customer | **no test anywhere references it** |
| `index.html:4160/4176` | Venmo deep-link `?amount=` — rides on `totalDue` | no |

Two concrete consequences:

1. **The portal is a genuine third implementation with different rules.** It
   computes `totalDue` in plain browser JS and derives a two-state label
   (`Paid in Full` / `Balance Due`) rather than the three-state
   `Unpaid / Partial Payment / Paid in Full`. Critically it does **not** use
   `centsOf`. The cent-rounding comment in `js/money.js` describes exactly the
   bug this reopens: a floating-point crumb leaves `totalDue` at ~1e-13, the
   office screen says *Paid in Full*, the customer's portal says *Balance Due*
   above an amount rendered `$0.00`, and the Venmo link offers to charge them
   `$0.00`.
2. **`balanceDueAmount()` is the intended single source of truth in `admin.html`
   and is used as one — but only there.** 12 callers inside `admin.html`; three
   sites in the same file still inline the formula anyway (12885, 13131, 13207),
   and neither `functions/index.js` nor `index.html` has any equivalent. So the
   helper does not fail R-010; what fails is that the other two surfaces, which
   are the ones that actually charge and actually face the customer, were never
   given a copy of it.

Guardrail §2 says "do not add a fourth place that computes money". There are
already about twelve, and R-015's claim that money lives in exactly two
parity-tested places is **false as written** for the amount owed.

**Resulting map change:** `docs/RULES.md` R-015 amended 2026-08-21 and marked
TARGET, distinguishing the *status* (2 places, parity-tested — accurate) from
the *amount owed* (~12 places, untested until now). Phase 0a step 1 —
`money-parity.test.js` extended to compare every one of those sites against
`balanceDueAmount()` — landed 2026-08-21; findings recorded there. Step 2, the
consolidation itself, is not done.

---

## Q-002 · factual · answered · 2026-08-21
Can the 19 health checks run headless, or are they welded into the panel?

**Answer: they already do run headless — 11 of the 19 have real fixtures today.**

`hcRunChecks()` (`admin.html:33949–34327`) is pure: **zero** DOM references,
**zero** Firestore calls. It reads five module-level caches (`jobAddresses`,
`allInvoicesCache`, `warehouseExtras`, `availableCustomerNumbers`,
`nightlyHealthCache`) and returns a plain array of
`{id, title, why, rows, fix}`. All the DOM lives in `hcRender()`, which is a
separate function.

`run-all.js` Suite 7 already lifts the whole block into a `new Function`
sandbox and **executes the real `hcRunChecks()`** against fabricated records —
15 fixture set-ups, 27 assertions. So the extraction work §7.3 warns "adds
scope" is largely done; what remains is moving it to a real module so the panel
and the suite import one copy instead of the suite scraping the page.

Its non-cache dependencies are ten small helpers, two of which
(`computeInvoiceStatus`, `custInvoiceKey`) already live in `js/money.js`. The
other eight (`hcDigits`, `hcName`, `hcAddr`, `hcHasMapPin`, `hcInvoiceGroups`,
`hcSharedPhoneGroups`, `toDateStr`, `extractCleanCity`, `fmtPhone`,
`whUnreadableLightParts`) are local to `admin.html`.

Behavioural fixture coverage, by check id:

- **Covered (11):** `dupNumbers`, `ghostStops`, `lightsNotPicked`, `lostQuotes`,
  `nightlyBilling`, `noEmail`, `noPin`, `poolConflict`, `staleStatus`,
  `staleStops`, `totalDrift`
- **Source-shape only (2):** `sharedPhone` (its helper `hcSharedPhoneGroups` *is*
  executed separately at `run-all.js:609`; the check id itself is regex-matched
  at 601), `noNumber` (`indexOf` at 13321)
- **No coverage at all (6):** `badBillTo`, `missingInvoice`, `noBundleBasis`,
  `noContact`, `orphanExtra`, `orphanInvoice`

**Resulting map change:** plan §9.2 should read "8 remaining fixtures", not 19,
and §7.3's headless requirement is already met in substance.

---

## Q-003 · factual · answered · 2026-08-21
Does Start New Season have a preview?

**Answer: yes, and a better one than §6.2 specifies. §6.2 does not become the
highest-priority item in the document.**

`admin.html:6151` — **Check First (writes nothing)** builds the plan and renders
it before anything is written:

- a headline count: *"Will reset N customers and M invoices"*
- the money: *"Banks $X of last year's payments … everyone owes $Y total"*
- a scrollable per-customer table (name, paid last year, owes this year, whether
  the $30 join fee drops)
- the **Run** button is `display:none` until Check First has been pressed
- status line: *"Nothing written yet — review the list, then press Start New Season."*

The run handler adds a `confirm()` restating all of it, then — before touching a
single invoice — writes a full per-customer snapshot to `yearlySnapshots/{year}`,
**reads it back**, and aborts if the row count doesn't match. There is also a
document-size guard (`SSN_SNAPSHOT_MAX_BYTES`, 900 KiB) that refuses rather than
writing a partial snapshot that would look complete.

So R-006 is satisfied for this operation. What is genuinely missing:

- **R-007 (blast-radius cap): absent.** Nothing compares the change count against
  the prior run. The only cap is on snapshot *bytes*, not on records touched.
- **R-008 (diffable post-run log): partial.** `seasonResetCount` and
  `seasonArchivedTotal` are persisted, but they are written *before* the run and
  restate the *prediction*. What actually happened is a status line on screen.
  The `catch` says "some may have reset" and records nothing about which.

For comparison, **Delete All Customers** (`admin.html:26043`) is weaker: a
type-`DELETE` unlock and a `confirm()` naming the count, but **no itemised dry
run**. If §6.2-style work is done, that is the operation that needs it.

**Resulting map change:** phase 4 shrinks to branch protection + R-007 cap +
R-008 actual-vs-predicted log, and Delete All Customers inherits the preview
requirement instead of Start New Season.

---

## Q-004 · factual · answered · 2026-08-21
How much of `run-all.js`'s 3,467 checks are source-shape assertions vs. real logic?

**Answer: about 20% source-shape, about 70% behavioural. 3,467 is meaningful
coverage, not structural noise.**

Measured, not estimated: a copy of `run-all.js` was instrumented to record the
call-site line of every `check()` invocation via stack capture, then each
site's condition expression was parsed and classified. 3,458 of 3,467 checks
were captured (99.7%; the 9 missed sit behind an extra stack frame).

|  | condition = computed value | condition = matches source text |
|---|---|---|
| **suite executes app code** | **2,575** (74.5%) | 522 (15.1%) |
| **suite reads source text only** | 196 (5.7%) | 165 (4.8%) |

- **Clearly source-shape: 687 (19.9%)** — a regex, `.includes()` or `.indexOf()`
  against `admin`, `fns`, `idx` or a slice of one.
- **Behavioural: 2,575 (74.5%)** — inside a suite that lifts app code into a
  `new Function` sandbox or a jsdom DOM and asserts on the *result*. Spot-checked
  across 14 evenly-spaced samples; they are real
  (`tc({houses:[…]}) === 2`, `sb3.save(job) === false`,
  `r.el('editCustFeet').value === 300`, `worstDay(built).towns.length <= 4`).
- **Contract scans: 196 (5.7%)** — id existence, `<div>` balance, index coverage.
  These are text-derived but R-019 classifies contracts as **block**, not warn.

Two caveats, stated rather than smoothed over:

- **144 checks (4.2%)** in the behavioural column are `!!extractedThing`
  "the function still exists" guards. Those are source-shape in spirit.
- **173 checks (5.0%)** had conditions the argument-parser couldn't isolate
  (multi-line expressions) and are counted as behavioural by default.

Of 137 suites, **112 execute application code** and 25 are text-only; the 25
text-only suites hold just 361 checks between them.

**Resulting map change:** §7.6's demotion applies to roughly 687 checks, not
"most of them". It is a small, low-yield job and should sit at the back of
phase 5, not the front. R-019's tiering stays correct as written.

---

## Q-005 · intent · open · 2026-08-21
How many days before install should the confirmation text go out?

Needs to be far enough ahead to fix problems, close enough that the customer
hasn't forgotten. Addie's call.

Context from the code that may help the decision: the crew schedule is already
frozen inside a **48-hour** window (`routeDayIsLocked`, measured to the *start*
of the day because the truck is loaded the night before). A confirmation that
lands inside that window can be read but cannot change anything, so the answer
should be meaningfully larger than 2 days. The warehouse builds one working day
ahead of the van, which pushes the practical floor further out again.

Blocks: plan §4.2, the send scheduler.
Answer:
Resulting map change:

---

## Q-006 · intent · open · 2026-08-21
What happens to a job whose confirmation comes back disputed?

Block the crew sheet? Flag and proceed? Who gets notified?

`docs/RULES.md` R-005 currently answers half of it — *"a disputed confirmation
blocks the crew sheet from being treated as final"* — but "treated as final" is
not defined anywhere in code, and R-005 is a tier-1 `read` rule with no
enforcement behind it. Three sub-questions that need separate answers:

1. Does *disputed* stop the sheet **printing**, or just mark it?
2. If the install is inside the 48-hour lock when the dispute arrives, does the
   crew still go? (The schedule cannot be rebuilt at that point.)
3. Who is told — a System notice in the Inbox, the nightly Twilio summary, or a
   badge on the customer record? The Inbox is the list the office reads every
   morning; the Twilio summary is the one that reaches a phone.

Blocks: plan §4.2, §4.4, and the enforcement behind R-005.
Answer:
Resulting map change:

---

## Q-007 · intent · open · 2026-08-21
What is the real option set for `js/options.js`?

`js/options.js` shipped with the plan and is **a placeholder that says so in its
own header**: *"TODO(addie): the entries below use my best guess at your
vocabulary. Replace them with your real option set — that's the only part I
can't write."*

Plan §3.2 states the file is "already added to the repo, with the real option
set filled in". It is not. Its seven entries (`rooflineFt`, `bulbColor`,
`timer`, `walkway`, `wreaths`, `bins`, `accessNotes`) match no field name in the
repo. The real vocabulary is `measuredFeet`, `lightsDescription` /
`lightColors`, `wireColor`, `outletTimer`, `specificOutlet` /
`specificOutletNotes`, `useEaves`, `houseSides` / `houseSideCount`,
`numberOfBins`, `gateCode`, `oneTimeNote`, `notes`, `difficulty`,
`installPreference`. The placeholder also encodes business rules that are wrong
here — a C9 bundle every 25 ft, where the shipped rule is `ceil(feet / 40)` for
bundles and one bin per 260 ft (`CN_DOUBLE_BIN_FEET`).

There is already a partial, load-bearing registry to derive from rather than
starting blank: `PORTAL_WRITE_FIELDS` and `PORTAL_READ_FIELDS` in
`functions/index.js:554–580`. `PORTAL_WRITE_FIELDS` is even grouped by
save-section, and its `sides` group carries the same "this one changes the
price" distinction `affectsPrice` is trying to express.

Nothing imports the file today: zero call sites for `OPTIONS`, `audit()`,
`missingAnswers()`, `crewSheet()`, `pullList()` or `confirmationText()`.

Per `CLAUDE.md` §4, **an unanswered `intent` question on a customer-facing data
path blocks the change** — so phase 1 cannot start on the current contents. What
is needed is not a code decision: it is which options a customer may actually
ask for, which of the five artifacts each must reach (R-003), and which affect
price (R-004).

The mapping from existing fields can be derived from the code and is my job, not
Addie's. What only she can answer is which options are *real*, and whether any
are sold today that the software has no field for (plan §12, "not in the system
at all").

Blocks: **all of phase 1**, and therefore phases 2, 3 and 7 which depend on it.
Answer:
Resulting map change:
