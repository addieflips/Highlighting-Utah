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

## Q-005 · intent · answered (moot) · 2026-08-21
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

**Answer (Addie, 2026-08-21): the question does not apply. There is no
pre-install confirmation — it is the RSVP email, which goes out once at the start
of the season.** *"This is for emails we don't have twillo and this would be for
RSVP emails."*

That is earlier than any N-days-before-install answer would have been, and
therefore better: it lands before anything is built, while there is still time to
change everything. It also means plan §4.2's Twilio path is wrong — the Twilio
code exists but the service is not in use, and the RSVP email already goes out
through Automation Emails.

**Resulting map change:** plan §4.2 rewritten in effect — no new send path, no
new scheduler, no N. The option list becomes a block in the existing RSVP email.

---

**Map rows (added 2026-08-26):** `RS-11` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-006 · intent · answered · 2026-08-21
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

**Answer (Addie, 2026-08-21): there is no disputed state. Retire the idea.**

The question dissolved rather than being answered, and the reason is worth
keeping. Q-005 established that the confirmation is not a separate pre-install
message — it is the **RSVP email**. The RSVP accepts exactly three answers, and
`portalRsvp` (`functions/index.js:1356`) rejects anything else outright:

```js
if (['yes', 'no', 'backnextyear'].indexOf(response) === -1) { ...reject... }
```

So `disputed` had nowhere to live. R-005 was a **tier-1 rule guarding a state the
system cannot produce** — which is worse than having no rule, because it reads as
protection while providing none. Retired in place 2026-08-21, logged in
`docs/RULES.md`.

**What was rejected, and why, so it is not rebuilt:** a catch-all "something is
wrong" reply. It sounds safer and is not — an answer that sometimes means *don't
come* and sometimes means *my colours are wrong* is how a crew skips a house that
was fine. The two real cases already have homes: a customer with a problem calls
the office, and a customer with a wrong detail fixes it in the portal, which is
what the portal is for.

**And showing the price is not the same as offering a way to argue with it.** The
price line goes on the RSVP email under R-004 so there is a record that they saw
it and said yes — that protects the business, it does not invite renegotiation.
`housePrice` has never been in `PORTAL_WRITE_FIELDS` and this does not change
that; a customer can only ever edit facts about their own house.

**Resulting map change:** R-005 retired. Plan §4.2's `confirmationStatus`
(`pending`/`confirmed`/`disputed`) and §4.4's *"a disputed reply visibly flags the
job in admin"* are both superseded — the RSVP's own four states
(`yes`/`no`/`backnextyear`/`unanswered`) are the whole vocabulary.

---

**Map rows (added 2026-08-26):** `RS-12` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-007 · intent · ANSWERED · 2026-08-21, closed 2026-08-25
What is the real option set for `js/options.js`?

> **CLOSED 2026-08-25 — this was answered and the entry went stale.** The
> question below describes a placeholder file with seven invented field names
> (`rooflineFt`, `bulbColor`, `walkway`, `wreaths`…). That file no longer
> exists. `js/options.js` holds the real fourteen — `measuredFeet`,
> `lightsDescription`, `wireColor`, `outletTimer`, `useEaves`,
> `specificOutlet`, `gateCode`, `houseSides`, `installPreference`, `notes`,
> `oneTimeNote`, `wantsMailedInvoice`, `numberOfBins`, `difficulty` — derived
> from the code and corrected by Addie on 2026-08-21, with the working kept in
> `docs/option-registry-draft.md`. `options-audit.test.js` gates it and its
> frozen AGREED map holds her destination answers.
>
> ⚠ **It no longer blocks anything.** The sentence below saying it blocks all
> of phase 1 was true of the plan as written, and that plan changed: on
> 2026-08-25 the generation half was deleted rather than built (owner, twice:
> *"so we'll have code that will just sit there doing nothing forever"*). The
> registry declares and the artifacts stay hand-written, which is recorded in
> the file's own header. Nothing is waiting on this.
>
> ⚠ **What is genuinely still unanswered is smaller and is not this question:**
> whether anything is sold today that has no row at all. That one is invisible
> to every check by construction — a missing row cannot fail an audit — so it
> can only ever be answered by asking her, and it is not blocking work.
>
> The original text is kept below unedited, because its derivation of the real
> vocabulary from `PORTAL_WRITE_FIELDS` and `PRINT_COLUMNS` is the reasoning
> the registry rests on.

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

**Status 2026-08-21: a draft is ready for review at `docs/option-registry-draft.md`.**
Fourteen options derived from the code — the `quoteDetailForm` submit handler
(`index.html:2702`) settles the customer-facing list, `PORTAL_WRITE_FIELDS`
settles what a member may change later, and `PRINT_COLUMNS` settles what actually
reaches paper. Each row carries the evidence it came from, so a wrong line can be
checked rather than taken on trust.

That reduces this question to three things only Addie can answer, listed in §4 of
the draft: whether anything is sold today that has no row (Plan §12's blind spot —
invisible to every detector in the plan, permanently), whether anything other than
feet and sides changes the price, and what the confirmation text should list.

Building it surfaced four R-003 holes that no existing check could see, because
each field is correctly written, stored and read — they are holes *between*
artifacts: the gate code and which-outlet instructions never print, `useEaves`
prints but is absent from the crew portal, and the side count reaches neither.

Answer:
Resulting map change:

---

**Map rows (added 2026-08-26):** `OPT-01` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-008 · intent · answered · 2026-08-21
On a health-check notice in the System inbox, what does **Deny** mean?

Design agreed in conversation 2026-08-21: instead of findings sitting silently in
the Health Check panel, a finding that needs a judgement call is delivered as a
System notice, and the office approves or denies it there. Denying is how an
exception gets made, which means Deny needs a defined lifetime. Three readings,
and they behave very differently six months later:

1. **Never again for this customer.** Simplest, and the most dangerous: deny
   `sharedPhone` for the Andersons and you will never be told when a *fourth*,
   wrong house joins that number.
2. **Not until the data changes.** The notice carries a fingerprint of what it
   excused; when the underlying values change, the fingerprint changes and a
   fresh notice is raised. This is how `priceReviewed` already behaves — it goes
   back to `false` on its own whenever a new price is auto-derived.
3. **Not this season.** Clears on Start New Season, like an RSVP answer.

(2) is the recommendation, because it is the only one that cannot silently go
stale, and it already has a working precedent in this codebase. But it is a
policy decision about money and customer data, so it is Addie's.

Blocks: the approve/deny mechanism, and therefore the exception model for all
twelve judgement-call checks.

**Answer (Addie, 2026-08-21): (2) — not until the data changes. AND the denial is
PER MEMBER: "I should be able to choose what member I'm denying for and approve
for all other members if we run into that situation."**

⚠ THE PER-MEMBER HALF CONTRADICTS HOW I SAID THE NOTICE HAD TO BE BUILT, and her
version is the right one. Q-009 argued that a notice must be
one-per-check-with-counts rather than one-per-finding, because `messages` refuses
any create over 5,000 characters. That is still true — but I had assumed the
DECISION lived on the notice, and if it did, per-member granularity would be
impossible for any check with more than a handful of rows.

So the decision must NOT live on the message document. The notice is the
delivery surface — an alert that says what was found and how many — and the
decision is recorded per finding, keyed by `check id + member id + fingerprint`.
That keeps the 5,000-character cap entirely out of the decision path, and makes
per-member denial work for a check with fifty rows as easily as one with two.

Deny one row, and the rest stay approved. A denied row comes back on its own the
moment its fingerprint changes, which is what "not until the data changes" buys.

**Resulting map change:** P-002 rewritten to the decided design. A new
`healthCheckDecisions` collection (or equivalent) keyed on check + member +
fingerprint is now part of phase 5's walker, not a bolt-on to the panel.

---

**Map rows (added 2026-08-26):** `HC-01` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-009 · intent · answered · 2026-08-21
Which health checks should raise a System notice at all?

Not all nineteen, or the inbox becomes the thing nobody reads — which is the
failure R-013 names. Two natural groups, from the panel's own data:

- **Six have an auto-fix button** (`poolConflict`, `missingInvoice`,
  `totalDrift`, `staleStatus`, `ghostStops`, `staleStops`). These have exactly
  one correct answer, so a notice asking permission to do the obvious thing is
  friction, not safety — unless the point is that nothing should auto-write
  without being asked, which is a defensible position and Addie's to take.
- **Twelve carry `fix: null`** with a note saying a human has to decide
  (`dupNumbers`, `orphanExtra`, `noBundleBasis`, `lightsNotPicked`,
  `orphanInvoice`, `lostQuotes`, `noContact`, `noEmail`, `sharedPhone`, `noPin`,
  `nightlyBilling`, `badBillTo`). These are the natural candidates.

⚠ Volume is the real constraint, not preference. Some of these have a large
standing population — `noEmail` and `noPin` plausibly dozens of rows — and the
`messages` collection refuses any create over 5,000 characters. That is not
hypothetical: the routes reconcile note grew past that cap and failed silently
for weeks, reported as "Missing or insufficient permissions" (see CLAUDE.md).
So a notice has to be one-per-check-per-change with counts, never
one-per-finding, and it has to be trimmed with what did not fit **counted**
rather than cut.

Blocks: how many notices the inbox gets on day one.

**Answer (Addie, 2026-08-21): all of them notify. "I want to be able to approve
or deny it. But after approve it can auto write."**

So approve/deny is defined, and is no longer the ambiguous pair I warned about:

- **Approve** = this finding is real. Where the check has an auto-fix (six of
  them), approving RUNS it — no second button, no separate trip to the panel.
  Where it does not (the other twelve), approving means it stays open as real
  work and surfaces on the record itself (R-012).
- **Deny** = this one is fine. Records an exception, per member, scoped to the
  fingerprint, per Q-008.

⚠ THIS PROMOTES THE NOTICE INTO A WRITE PATH, and tier 2 now applies to it. One
click on a notice reading "43 invoices have drifted totals" is 43 money writes.
That is a bulk operation by any reading, so R-006 and R-007 attach:

- the notice must STATE WHAT APPROVING WILL WRITE, with counts and totals, before
  it is approved — the notice is the preview R-006 requires, so it has to
  actually contain the preview;
- R-007's blast-radius cap applies: refuse, and ask for an override, when the
  count is far above the usual run;
- R-008: what it actually wrote gets logged, diffable against what the notice
  said it would write.

Deferring the auto-write until approval is a genuine safety improvement over
today, where six fixes are one unguarded button press in the panel with no
preview and no record. It is only an improvement if the preview is real.

**Resulting map change:** P-002 rewritten. The six auto-fixes move from
"button in the panel" to "runs on approval, from a notice that previewed it",
and pick up R-006/R-007/R-008 on the way.

---

**Map rows (added 2026-08-26):** `HC-02` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-010 · intent · ANSWERED · part 2026-08-22, Q-010a 2026-08-26
"Straight yes only" — when should `SEASON_ELIGIBILITY` be flipped, and does a
converted customer's assumed yes count?

Addie, 2026-08-21: *"straight yes is the only thing to count for RSVP for the
season."* The switch for this already exists and its `confirmed-only` branch is
implemented and tested in both modes:

```js
const SEASON_ELIGIBILITY = 'all-but-maybe-next-year';   // or 'confirmed-only'
```

⚠ **It must not be flipped yet.** No RSVP has gone out, so nearly every customer
is unanswered and `confirmed-only` puts every one of them out of the season — no
routes, no builds, no installs. The comment already on that line says the same:
flip it *"when the RSVP email is live and everyone has actually been asked."*

**Q-010a — when?** After the first RSVP send, presumably with some window for
replies. Addie's call, and it wants a deliberate date rather than a guess.

**Q-010b — does an assumed yes count? — ANSWERED, no.**

Addie, 2026-08-22: *"They need a reply either through email or approving through
the button. We should be able to approve for them in costumers as well."*

`confirmed-only` tested `rsvpStatus === 'yes'` alone. Converting a quote writes
`rsvpStatus: 'yes'` with **no `rsvpRespondedAt`** — the office knowing they want
lights, nobody having asked them about this season. On the status alone, turning
the setting on would have kept in the season precisely the people it exists to
exclude, **and it would have looked like it worked**: the routes would fill, the
list would look healthy, and every name on it would be somebody who never replied.

Fixed 2026-08-22, `isOutForSeason`:

```js
if(SEASON_ELIGIBILITY === 'confirmed-only'){
  return !(String(d.rsvpStatus || '').toLowerCase() === 'yes' && !!d.rsvpRespondedAt);
}
```

This is now the same test the Excel "Yes" tab has always used
(`said === 'yes' && d.rsvpRespondedAt`). Two places deciding "did they really say
yes" and disagreeing is worse than either being wrong alone. **One rule, one
answer** — and a check asserts both sites read it the same way.

**All three of her routes stamp the date, so nobody who replied is lost:**

| Route | Where | Stamps `rsvpRespondedAt` |
|---|---|---|
| the RSVP email link / portal button | `portalRsvp` | yes |
| approving a quote by email | `quoteRespond` | yes |
| Back Next Year | `pullCustomerFromSeason` | yes |
| **the office marking it for them** | Edit Customer → RSVP Status | yes |

That last row is her *"approve for them in costumers"* — it already exists, in the
Edit Customer form, and it was taught to stamp the date for exactly this reason:
an answer taken over the phone is still an answer, and without the stamp it could
not be told apart from an assumed yes. The only `'yes'` written *without* a stamp
is the one at conversion, which is the assumed one.

⚠ It is dead code until the switch is flipped, which is why fixing it now costs
nothing — and why it had to be fixed *before* the flip rather than after.

**⭐ RESOLVED 2026-08-22 — WE NEVER ASSUME AN APPROVAL.** Addie: *"We shouldn't
assume they approved we should always know they approved so if we get no response
from someone than we will assume they will be back next year but will leave it as
no response."*

Three things follow, and two of them are built:

**① The source is gone.** Converting a quote no longer writes `rsvpStatus: 'yes'`.
The office knowing somebody wants lights is not that customer answering a question
about *this season*, and writing it as a yes made the two indistinguishable. Every
reader then had to be hardened against a value the writer should never have
written — and the one that got missed was the Dashboard's Yes card, i.e. the exact
number you would read to decide Q-010a.

⚠ Nothing is lost. A blank RSVP is IN the season under the live setting, so a
converted customer is still routed, scheduled and built for; and they still reach
the Excel Yes sheet through the new-hang route, which is what they are. They now
show as **Pending** — nobody has asked them — which is true, and they fall into the
RSVP audience so they will be.

**② The readers agree.** `effectiveRsvpStatus` is the one place that decides
whether an approval was really heard: a `yes` with no `rsvpRespondedAt` reads as
Pending. Used by the Dashboard cards, the customer row, the RSVP panel pills and
the Automation Emails "Yes" audience. It exists as well as ① because the ~960
records already in the book carry the old value — a rule enforced only at the
writer is one legacy data walks straight past.

⚠ It keeps the five states a **partition**: an assumed yes reads as Pending, not a
sixth bucket, so the Dashboard counts still add up to the customer list.

**③ Non-responders — still Q-010a.** *"We will assume they will be back next year
but will leave it as no response"* is exactly what `confirmed-only` does: only real
replies stay in the season, and nobody's status is rewritten to say something they
never said. ⚠ Nothing writes `backnextyear` for a non-responder and nothing should.
The flip itself still waits on the RSVP going out — see the warning above.

### ⚠ Found while checking this: Back Next Year did not keep anybody out

Addie, 2026-08-22: *"back next year should be on 2027 and not split for this year
on schedule."* The **2027** half was already right — the Excel Contact 2027 tab
reads both the flag and the status, and has since 2026-08-20. The **schedule**
half was not, in two separate places.

**① `isOutForSeason` only read the flag.** Its comment claimed the status "never
travels alone" — that `pullCustomerFromSeason` always sets `maybeNextYear` beside
it. `portalRsvp` does **not**: it writes `rsvpStatus` alone, and sets
`needsLightRecycle` only for a *"no"*. So a customer who answered Back Next Year
**through the RSVP link** carried no flag and read as fully in the season — routed,
built for and scheduled. And because `portalRsvp` pulls them off upcoming routes
the moment they answer, while the nightly fill put them straight back, it looked
intermittent rather than broken. That is the same ping-pong the `needsLightRecycle`
rule exists to stop for *"no"*.

⚠ Two comments in one file contradicted each other — the Contact 2027 tab says
*"portalRsvp writes the status alone, and only the office button writes both"* —
and the one that was wrong is the one deciding who gets a crew.

⚠ Fixed in `isOutForSeason`, **not** by making `portalRsvp` set the flag: the flag
is what the office sets and sees, and writing it from a customer's own answer would
badge them Maybe Next Year without anybody choosing to. The two mean different
things; both mean not this season.

**② Nothing ever took anybody OFF the plan.** `customersMissingFromSeason` asks
`isOutForSeason` before putting somebody **on** a day, and nothing asked again
afterwards — so a customer placed on the plan who *then* left the season stayed on
it through every Recalculate, for ever. The routes side has had two ways to drop
them (`stopProblem`'s sweep, `removeCustomerFromUpcomingRoutes`); the schedule had
none. `rebuildSeasonDays` now drops them out of the movable pile, asks the shared
rule rather than growing its own, keeps a house whose customer cannot be found
(imported rows need not match one), never touches takedowns or fixes, and reports
both what it took off and anybody it could not — a day inside the 48-hour lock is
printed and loaded, and a rebuild cannot un-print paper.

**③ And the warehouse still built for them — five sites, one shared rule now.**
Addie, 2026-08-22, asking for confirmation: *"back next year will go to 2027
right? And won't go to recycle or be approved for this year?"* Checking that
turned up the same flag-only test in five more places, all reading
`d.maybeNextYear` while `portalRsvp` writes the status alone:

| Site | Was | Now |
|---|---|---|
| `whBuildQueueGroups` — the build queue | `d.maybeNextYear` | `isOutForSeason(d)` |
| the warehouse colour totals | `!item.data.maybeNextYear` | `!isOutForSeason(…)` |
| `computePendingHouseCount` | `!item.data.maybeNextYear` | `!isOutForSeason(…)` |
| `whHouseBuildStatus` — *"why isn't she here"* | `d.maybeNextYear` | `isOutForSeason(d)` |
| `printNeedsBuildList` — the printed sheet | **no season rule at all** | `isOutForSeason(d)` |

That last row is the worst of them: the printed Needs Building sheet listed people
the warehouse screen beside it had already dropped, including anybody the office
had badged Maybe Next Year. Two lists of one job disagreeing is how the one on
paper stops being trusted.

⚠ Using the shared rule also stops a house being built for an RSVP of **no**,
whose bundle is queued to be taken apart — building and recycling at once is two
jobs cancelling out, and the comment at that site already said as much. Somebody
who **moved** (`recycleKeepingCustomer`) is *not* out and still gets their new set,
which is the whole reason Recycle and Build are two separate buttons.

**Confirmed by running the real predicates**, both shapes, 2026-08-22:

| | 2027 tab | Yes tab | in season | build queue | recycle queue |
|---|---|---|---|---|---|
| answered through the RSVP link | **yes** | no | no | no | no |
| badged by the office | **yes** | no | no | no | no |
| an ordinary customer, for contrast | no | yes | yes | yes | no |

**④ And an RSVP of "no" now keeps them out on its own — a deliberate reversal.**
Addie, 2026-08-22: *"someones that says no should go to recycle. But they can
change there decisions to Yes or back next year and it will update."*

⚠ **This reverses her own 2026-08-15 decision**, which was that only Maybe Next
Year keeps somebody off the list. Both the old reasoning and this note are kept in
the code so nobody restores it by accident. What was wrong with the old rule: an
answered *no* kept somebody out only through the **physical** consequence — the
queued recycle — and the warehouse **clears that flag when the job is done**. So
*"no"* lasted exactly as long as the warehouse queue, and the customer silently
rejoined the season a week later having never changed their mind. The answer
decides now; the flag only ever backed it up.

The other half of her sentence already worked and is now asserted: nothing about
*no* is sticky. Every route that takes a new answer rewrites `rsvpStatus`, so
**no → yes** puts them straight back in (and `rejoinedAfterRecycle` re-queues the
build, because their bundle was taken apart and a crew would otherwise be sent to
an empty bin), and **no → Back Next Year** moves them to the 2027 tab.

Fixed on the way past: the reconcile sweep called an answered *no* *"has not
confirmed for this season"* once the recycle was finished. They did confirm — the
answer was no. A notice giving the wrong reason is worse than one giving none.

Blocks: the flip itself, which is tier 1 — getting it wrong means nobody is
scheduled.
Answer: Q-010b answered 2026-08-22 — a reply is required; assumed yes does not
count. Q-010a (the date) still open.
Resulting map change: `isOutForSeason`'s `confirmed-only` branch now requires
`rsvpRespondedAt`; asserted against the Yes-tab predicate so the two cannot drift.


### ⭐ Q-010a ANSWERED 2026-08-26

Addie: **"any RSVP should be a straight yes starting when emails are sent."**

So there is **no grace window**, and the trigger is an EVENT rather than a date — which
is better than a date, because the fact is already recorded: `rsvpSentAt`, stamped on
the first real RSVP send. It also matches how she described this in August: *"That is
just to tick a box once I send out RSVP emails right?"*

**Nothing was flipped.** The RSVP has not gone out, so `SEASON_ELIGIBILITY` stays
`all-but-maybe-next-year`; flipping it now would empty the season down to the handful
who happened to reply to something else. That guard is unchanged.

**What changed** is the one thing that was failing quietly: a first RSVP send recorded
itself and said nothing about the switch, so the office would send, read a green
confirmation, and leave the season counting everybody. It now says so and names where.

⚠ **The send still does not flip it, and that is deliberate.** Flipping takes every
unanswered customer — ~960 on send day — off the routes, the schedule and the build
queue at once. The Dashboard switch shows that count *before* acting
(`seasonEligibilityWouldDrop`, measured by running `isOutForSeason` both ways), and
doing it from the send would skip the one number that makes the decision answerable.
It is reversible either way: nothing is written to a customer.

**Resulting map change:** **MON-24**, answering the open half of **MON-22**.

---

**Map rows (added 2026-08-26):** `RS-13, RS-14` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.

## Q-011 · intent · answered · 2026-08-21
An admin sets "Before Thanksgiving" in Customers. Should that re-place them on
the schedule — and is it worth what it costs?

Addie, 2026-08-21: *"that should only be assigned by admins in admin portal
through customers and then that should go into reassign for that member … before
thanksgiving or after thanksgiving depending on what they choose."*

**The two halves behave completely differently today. Verified by executing the
real code, not by reading it.**

### After Thanksgiving — already works
`prefKey('After Thanksgiving')` → `'thx'`, distinct from `'nov'`. So the
five-minute customer sync sees the change and pushes it to the plan, and
`houseAllowedFrom` gives it a floor that `enforceInstallTiming` honours by moving
the house LATER. Nothing to build.

### Before Thanksgiving — broken in two places

**① The change never reaches the schedule.** `prefKey` returns `'nov'` for BOTH
`'November'` and `'November - Before Thanksgiving'` — the `NOV` prefix match
catches it. `SCHEDULE_SYNC_FIELDS`'s `pref` entry compares with
`prefKey(a) === prefKey(b)`, so setting Before Thanksgiving on a November
customer reads as *no change* and is silently dropped.

⚠ **That collapse is deliberate and asserted** at `run-all.js:11053`, with the
reason given: *"the sheet and the record spell these differently; treating that
as a change would rewrite every house on every tick."* The master sheet can only
say `OCT` / `NOV` / `THX` / `ANY` — it cannot express Before Thanksgiving at all —
so a plan house imported from the sheet says `NOV` while the record may say the
long form. Distinguishing them makes the sync push the long form onto the plan.
My reading is that this converges after one pass rather than churning for ever
(unlike OCT vs October, which is a true spelling variant) — but it would rewrite
every such house once, and it overturns an assertion a previous session wrote
deliberately. **That is the cost, and it is Addie's to accept.**

**② Even if it arrived, nobody gets moved earlier.** `enforceInstallTiming` acts
only on houses scheduled BEFORE they are allowed:

```js
const from = houseAllowedFrom(h, startStr);
if (!from || here >= from) return;   // allowed to be here
```

There is no deadline branch — `houseDeadline` appears **zero times** in that
function. So a Before-Thanksgiving customer sitting on 10 December is never
pulled earlier, and misses the holiday they asked to beat.

Adding a deadline branch is genuinely new behaviour in a sweep that runs every
five minutes over the saved plan, and CLAUDE.md records that sweep breaking
things before. It also needs its own answer: **when nothing earlier has room, what
happens?** Move them anyway and overfill a day, leave them and report them stuck
(what the too-early branch does today), or bump a house with no deadline to make
space?

### What I recommend
Do ① and ② together or neither — ① alone makes the value arrive somewhere that
still cannot act on it, which looks fixed and is not. And take the "nothing has
room" answer as *report them stuck*, matching the existing branch, because a
customer visibly stuck is fixable and a silently overfilled day is found on the
road.

**Answer (Addie, 2026-08-21): yes to distinguishing the two, and (b) for the
no-room case — leave them where they are and report them.** Both shipped the
same day.

- `prefKey` gives `'November - Before Thanksgiving'` its own key, `'prethx'`,
  above the `NOV` prefix that used to swallow it. The spelling-variant collapse
  the old behaviour existed for (OCT/October, NOV/November, THX/After
  Thanksgiving) is untouched and still asserted.
- `enforceInstallTiming` now reads `houseDeadline` and works a WINDOW rather than
  a floor, so it moves a house that is past the day it asked to beat as well as
  one scheduled too early — and never overshoots the ceiling in the process.
- With nowhere legal to go, the house stays and is reported, matching what the
  too-early branch has always done. The office toast now says which way they are
  stuck; it used to say "no later day has room" to everybody, which is backwards
  for a deadline miss.

⚠ This also switches on the October deadline for the first time. `houseDeadline`
has always returned 31 October for an October house and nothing read it, so
"we need to get everyone who requested Oct done in Oct" (2026-08-18) was true of
the builder and not of the saved plan. Any October customer sitting in November
on the current plan will now be moved on the next sync, or reported if no
October day has room.

**Resulting map change:** none to the registry — this is scheduler behaviour.
Covered by six new checks in run-all.js Suite 46 and a rewritten assertion in
Suite 44.

**Map rows (added 2026-08-26):** `SCH-23, SCH-24` in `claude/questions-map.md` — the rulings in this answer, written where they can be found without reading this entry. R-023.
---

## Q-012 · intent · ANSWERED · raised and answered 2026-08-26
When one house on a shared bill sits the season out, what happens to the rest of
that household's bill?

**⚠ This blocks a change on a customer-facing money path, so per CLAUDE.md §4 it is
not being worked around. Nothing has been changed.**

### What the code does today, verified

`functions/index.js:3081` builds the payer's group and drops only a flat "no":

```js
const active = houses.filter(function (h) { return String(h.data.rsvpStatus || '') !== 'no'; });
```

Eleven lines later, the whole bill waits for every one of them:

```js
if (active.some(function (h) { return h.data.completed !== true; })) { skippedNotDone++; continue; }
```

A **Back Next Year** house (`rsvpStatus: 'backnextyear'`, `maybeNextYear: true`) is
therefore *in* `active` — and it is pulled off every upcoming route by
`removeCustomerFromUpcomingRoutes`, so no crew ever installs it and `completed`
**can never become true**.

**So the bill for that whole household is held open for the rest of the season.**
Every night the run reaches that payer, counts `skippedNotDone`, and moves on. The
nightly summary says "N skipped", which is the same words it uses for the ordinary
case of the crew not having got there yet — so nothing distinguishes a bill that is
waiting from one that can never send.

⚠ **This is the opposite of what `claude/silent-failures.md` §6 recorded.** That entry
said a Back Next Year house is "summed into the payer's invoice". It would be — line
3187 sums `housePrice` across `active`, and line 3290 writes them into
`billedHouseIds`, so their address would print on the invoice — but the hold above
fires first, so in practice **nobody is billed at all**. The money is not
over-charged; it is **not collected**.

### Scale

Only bites a shared bill. CLAUDE.md records **17 phone numbers held by two customers**
in the live book, **14 of them genuine households** (a parent paying for a child's
house). A lone Back Next Year customer is unaffected and correctly gets nothing — no
work was done.

### The disagreement underneath it

| Rule | Excludes |
|---|---|
| `isOutForSeason` (admin.html) — routes, build queue, recycle queue, schedule | `'no'`, `'backnextyear'`, `maybeNextYear === true` |
| `billedHousesByIds` / `billedHousesByKey` (server), `billingGroupsByPayer` (admin) | `'no'` **only** |

The browser and the server agree with *each other*, so `money-parity.test.js` cannot
see this — it compares the status string and the invoice key, not who is on the bill.

### Already settled — NOT being reopened

`pullCustomerFromSeason` states it in its own comment: *"Deliberately touches no money:
not coming back next year is not the same as not owing for last year."* Nothing here
proposes writing off work already done.

### The question

**Q-012a — the decision.** One house sits the season out; the others in the same
household have had their lights hung. Do they get their bill?

- **A. Bill the rest.** Leave the sitting-out house out of the group, invoice the
  others as soon as their work is done. Their invoice names only the houses actually
  lit, and the total is only those houses.
- **B. Keep holding the whole bill.** What happens today — but by accident, not by
  decision. If this is what she wants, it needs to be *visible*: the nightly summary
  must say which bills are held and why, instead of counting them as "skipped".

**Q-012b — the trap, stated as the assumption I would build under.** A house whose
lights *were* hung and who *then* said Back Next Year has had work done and owes for
it. So the exclusion would be **"sitting out AND never completed"**, never "sitting
out" — filtering on the RSVP alone would drop a house that genuinely owes, which is
the settled rule above pointing the other way. Confirm.

**Q-012c — the smaller one.** The office's own **Maybe Next Year** toggle sets the same
two fields as the customer answering through the RSVP link. Assumption: it counts the
same, as it does everywhere else in the season. Confirm.

### What would change if A

- One shared rule for "is this house on the bill", called by `runInvoiceBatch`,
  `billedHousesByIds`, `billedHousesByKey` and `billingGroupsByPayer` — four places
  today, which is how the two halves came to differ from the season definition.
- The nightly summary separates "waiting on the crew" from "held".
- Tests run the batch against a fixture household where one house sits out.

### Doing regardless of the answer

The nightly summary distinguishing a held bill from a waiting one is not a business
decision and does not depend on A or B — under B it is the whole fix.

**Resulting map change:** whichever way it goes, the answer becomes the one shared
"on the bill" rule plus a line in CLAUDE.md's money section, so the four copies cannot
drift apart again.

---

### ⭐ ANSWERED 2026-08-26

**Addie:** *"After the last persons house is done if there are multiple people on one
bill is when they will be charged."*

**The timing rule was already right; who counted was not.** `runInvoiceBatch` already
holds a multi-house bill until every house on it is `completed` — exactly what she
describes. What was wrong is that the group it waited on dropped only a flat `'no'`.

⚠ **The one thing her sentence does not say outright, and the only workable reading.**
"The last person's house is done" has to mean *the last house actually getting lights*.
A house sitting the season out is pulled off every upcoming route the moment they
answer, so no crew is ever sent and it can never be completed. If it counted as one of
the houses to wait for, her rule could never fire for that household and she would
never be paid at all. There is no reading in which a house nobody is visiting is one
we wait on. Stated to her before building, not assumed silently.

⚠ **AND WORK THAT WAS DONE IS OWED FOR** — already settled, not re-decided here.
`pullCustomerFromSeason`'s own comment: *"not coming back next year is not the same as
not owing for last year."* So `completed` is tested BEFORE the sitting-out branch. The
exclusion is **"sitting out AND never worked on"**, never just "sitting out" —
filtering on the RSVP alone would drop a house that genuinely owes.

⚠ **A FLAT `'no'` IS DELIBERATELY UNCHANGED.** It has always come off the bill outright,
and that is not what was asked about. See Q-013 below for the asymmetry that leaves.

**What was built.** `houseIsOnTheBill` (admin.html) and `houseIsOnTheBillServer`
(functions/index.js) — one rule, two copies, run side by side over every combination by
`money-parity.test.js`, exactly as `applyLightChange` is. All four readers call it:
`runInvoiceBatch`, `billedHousesByIds`, `billedHousesByKey`, `billingGroupsByPayer`.
⚠ It is **not** `isOutForSeason` — that governs routes, the build queue, the recycle
queue and the schedule and knows nothing about whether work was done. Two questions,
two rules, on purpose.

⚠ Red-checking found a hole worth recording: with money-parity guarding the helper,
reverting `runInvoiceBatch`'s own filter to the old inline test sailed straight through.
A rule in one place is worth nothing unless something asserts the callers ask it.

**Resulting map change:** `MON-15` in `claude/questions-map.md`. R-023.

---

## Q-013 · intent · ANSWERED · raised and answered 2026-08-26
A house that was hung and THEN answered a flat "no" — does it still owe?

Q-012 settled this for **back next year**: work that was done is owed for. A flat
`'no'` was left exactly as it was, because changing it was not what was asked and
widening a money ruling on my own is not on.

That leaves one asymmetry standing: a house completed and then answering `'no'` is
still dropped from the bill entirely, so the work is never charged for. By the same
reasoning Addie already applied to back-next-year it probably should be charged — but
*probably* is not a ruling on a money path.

⚠ Likely rare: RSVP normally happens before the season, so a house is not usually hung
first. Rare is not never, and it is silent when it happens.

**The question:** somebody's lights went up, and afterwards they said no for the season.
Do they get a bill for the work already done?

One line in `houseIsOnTheBill` / `houseIsOnTheBillServer` either way.

---

### ⭐ ANSWERED 2026-08-26

**Addie:** *"Any house hung no matter what should be charged. This will only be
overuled if it is our fault. But there is no reason we should not charge them if we
hung that lights and there is no reason to not charge them than we will charge them
still."*

**Hung is hung.** `completed` is now tested FIRST in both copies of the rule, ahead
of every status — a flat `'no'` included. It was one line: the check moved to the top.

⚠ **"OVERRULED IF IT IS OUR FAULT" IS A HUMAN DECISION, NOT A FIELD.** The office
writes it off on the invoice, and credits already exist for exactly that. An
automatic our-fault test would be the app guessing at fault, which is the one thing
it must not do with money. Nothing was built for it and nothing should be.

⚠ **The old check stayed green through the whole change**, because it tested the
flat `'no'` with `completed: false` — the one combination the ruling does not touch.
The new case had to be asserted explicitly. Two sabotages red-checked: demoting
`completed` back below the status checks fails on both sides.

**Resulting map change:** `MON-21` in `claude/questions-map.md`. R-023.

### ⚠ ASKED TWICE, ON THE SAME DAY, IN TWO SESSIONS — and the fuller answer is kept

This branch put the same question to her and got **"Yes — bill them for the work."**
Same ruling, less of it: the other session also got *"This will only be overuled if it
is our fault"*, which is the half that says what to do when it should NOT be charged.
Main's wording is therefore the one kept, and this branch's implementation was thrown
away rather than merged — it was byte-for-byte the same reordering.

⚠ **Two things did travel across**, and both are corrections rather than additions:

- the **Start New Season** argument, now in both code comments. This rule is safe only
  because the season reset clears `completed` on every customer; if that ever stops it
  bills people for last season's work every season, for ever. Verified in the reset
  write before either branch shipped, and written down in neither until now.
- the header comment above `houseIsOnTheBillServer` **still described the pre-Q-013
  rule** — *"a flat NO is unchanged… a house completed and THEN answering no is still
  dropped"* — directly above a body that no longer does that. True when Q-012 shipped,
  false the moment Q-013 landed, and the kind of stale comment that gets believed.

⚠ **THIS IS THE THIRD TIME TWO SESSIONS HAVE BUILT ONE RULE IN PARALLEL** (the others
are recorded below and under Q-012). Every time, both were red-checked and both were
right; every time, the cost was the merge rather than the code. Worth noticing before
starting a fourth.

---

## Q-010a follow-up · 2026-08-26 — the ruling, restated, and still not switched on

Asked when `SEASON_ELIGIBILITY` should flip, Addie answered with the rule rather than a
date: **"Only people that RSVP are yes and should be scheduled and invoiced."**

⚠ **NOT ACTED ON, and this is deliberate.** That is her standing intent (the same thing
she said on 2026-08-21) and not an instruction to flip it today. **No RSVP has gone out**,
so nearly every customer is `unanswered`, and turning it on now takes essentially the
whole book out of the season: no routes, no builds, no installs. The switch's own
comment says the same. What is still needed is a **date** — after the RSVP send, with
some window for replies.

⭐ **AND IT WIDENS THE RULE TO INVOICING**, which today is separate by design:
`isOutForSeason` governs routes and builds, `houseIsOnTheBill` governs money, and
`CLAUDE.md` warns by name against billing off the switch because it would empty every
invoice the day it is flipped.

⚠ **MON-21 is what makes her version safe**, and the interaction is worth stating
because it was not obvious: with `completed` tested above every answer, anyone whose
lights are actually up is billed whatever they did or did not reply. So the population
that "only RSVP-yes gets invoiced" would newly exclude is exactly the population that
had no work done. The danger the warning describes is real for the *scheduling* half and
mostly defused for the *money* half.

Still needs: the date, and a decision on whether the invoicing half goes in at the same
moment or after a season of the scheduling half.

**Resulting map change:** **MON-22**, recorded as *Decided — not built*.
### ⚠ AND THE SAME RULE WAS WRITTEN TWICE — folded into one on the merge, 2026-08-26

The billing-groups branch reached the identical rule from the other side, in the same
hours, and gave it a different name. Both were built, both were red-checked, both had a
completed axis in `money-parity.test.js`:

| | PR #140 (this entry) | the billing-groups branch |
|---|---|---|
| browser copy | `houseIsOnTheBill` in **admin.html** | `billedThisSeason` in **js/money.js** |
| server copy | `houseIsOnTheBillServer` | `billedThisSeasonServer` |
| `'no'` | out | out |
| `completed === true` | in (an early return) | in (a `&& completed !== true` tail) |
| backnextyear / maybeNextYear | out | out |

⭐ **`houseIsOnTheBill` survived and `billedThisSeason` was deleted.** Not because it is
better placed — `js/money.js` is arguably the righter home for a money rule — but
because it was already on `main`, already had four callers, and already carried nine
red-checked sabotages. Moving a freshly-proved rule for a placement nicety spends that
proof for nothing.

⚠ **NOTHING WAS LOST IN THE FOLD, and this is the part worth checking if it is ever
touched again.** Three things travelled across from the deleted copy:

- the **`SEASON_ELIGIBILITY`** argument, into `houseIsOnTheBill`'s comment — `isOutForSeason`
  also returns true for `needsLightRecycle`, and once that switch is flipped to
  `'confirmed-only'` it returns true for everybody who has not personally answered yes,
  so billing off it would empty the whole book's invoices in one day;
- four record shapes into the parity sweep's `STATES`. ⚠ **Measured afterwards, and
  none of them catches anything the existing list did not** — dropping
  `' backnextyear '` and then removing `.trim()` from a copy still fails, because
  `'  no  '` was already there and the trim is shared by every branch. They are kept
  as symmetry insurance, not as coverage, and the comment in the file says so;
- one correctness check: **a flat `'no'` stays out even on a house that was installed**,
  so the `completed` early return cannot reopen a path that was already settled.

⚠ **Q-012c is no longer a lone assumption.** Both branches independently treated the
office's own Maybe Next Year toggle as counting the same as the customer answering
through the link. Still never stated in words, but two independent readings agreed.

---

> ⚠ **NUMBERING, 2026-08-26.** Two sessions ran at once and both reached Q-012.
> Main's is the published one and keeps the number; the five raised on the
> billing-groups branch became Q-018 to Q-022 on the merge. Main's Q-012 and this
> branch's Q-021 are about the SAME customers from opposite sides — read them
> together before touching who is on a bill.
---

## Q-018 · intent · ANSWERED · 2026-08-26
When a house is billed to somebody else, what payment status should its own
row show?

Found while mapping the billing-group / house-tabs work. `getLiveInvoiceStatus`
answers "what is this customer's payment status" for two screens — Automation
Emails' Unpaid / Partial / Paid audience filters, and the Dashboard's RSVP list.
Its key bug is fixed (it asked the phone, so email-only customers had no status
at all — see Suite 275). This is the half that is **not** a bug with one right
answer.

A house with `billToPhone` set has no bill of its own. Its money is on the
payer's invoice. Today, and still after the fix, it resolves to whatever sits
under its own key — which is usually nothing, but **can be a real document**:
when a customer with a recorded deposit is switched to bill elsewhere, the Edit
Customer save keeps their old invoice and zeroes it (`install: 0, removal: 0,
changeFees: 0`) rather than deleting it, so the payment is not lost. A zeroed
invoice with a deposit computes to **Paid in Full**.

So that house reads "Paid in Full" on both screens while the bill it is actually
on may be entirely unpaid.

**ANSWER (Addie, 2026-08-26): the status follows the bill the house was added
to.** In her words: *"if Kyle didn't say no or back next year and his bill wasn't
already paid or partially paid but it added to Dana's bill than should be paid in
full by dana."*

`getLiveInvoiceStatus` now keys on `billToPhone || custInvoiceKey(d)` — the same
expression `billingGroupsByPayer` builds its map from. So a house billed to
somebody else reports that payer's bill: Unpaid while Dana owes, Paid in Full
once she settles.

⚠ **It removes the false reading as a side effect**, which is why this is the
right answer rather than merely a chosen one. The leftover zeroed invoice under
Kyle's own key computes to Paid in Full on its own; reading the payer's invoice
instead gives the truth. Suite 275 asserts both — that the leftover really does
read Paid in Full alone, and that the billToPhone half wins.

⚠ **The cost, accepted knowingly:** a chase-the-unpaid audience now includes
houses whose occupant personally owes nothing. Automation Emails already badges
those `[Billed elsewhere]` and has a group filter to exclude them, so it is
visible and avoidable rather than silent.

⚠ **The other two conditions she named are handled elsewhere, not here.**
Somebody who said no or Back Next Year is not billed at all (Q-021,
`houseIsOnTheBill`); a house that had already paid carries its money across as a
credit (Q-020, `paidBeforeBillTo`). This function only reports what the bill
says.

**Resulting map change:** **MON-16**. `getLiveInvoiceStatus` answers "what does the bill this
house is on say", not "what does this house's own invoice say". `allCustInvoiceFor`
still answers the second — the Edit Customer save needs it to find and zero a
leftover — and Suite 275 no longer asserts the two agree for a billed-elsewhere
house, because they deliberately do not.

---

**The three readings that were weighed, kept so they are not re-proposed:**

1. **Show the payer's status.** Honest about the money. But the Unpaid filter
   then includes people who owe nothing personally, and a chase email would go
   to a tenant about a landlord's bill.
2. **Show no status at all (null).** The `[Billed elsewhere]` badge already says
   why, `audienceBillingGroup` already computes it, and the nightly run only ever
   emails payers — so nothing about money is being hidden from anybody who could
   act on it. This is the recommendation.
3. **Leave it as it is.** Rejected: "Paid in Full" is a claim about money that
   can be false, and it is the one answer no reading supports.

Not guessed, because (1) and (2) send different email to different people.

⚠ **Related, and the reason this was not just fixed to (2):** the zeroed-invoice
shape is itself worth a decision. An invoice carrying only a deposit and no
charge is a payment archive, not a bill, and nothing marks it as one.

Blocks: nothing today. The house tabs' header balance needs it answered before
they ship, since a non-payer tab has to say something.

---

## Q-019 · intent · ANSWERED · raised and answered 2026-08-26
<!-- ⚠ FILED AS intent, THOUGH IT STARTS FACTUAL. The heading was
     "factual → intent" and questions-map.test.js parses the kind as [a-z]+, so
     the arrow made the whole entry invisible to the gate — an open question on a
     money writer that the open-questions count did not know existed. The first
     half really is factual and is answerable by one query against the live book;
     what is left after that is a decision, which is why it is filed here. -->
Can `syncPayerInvoice` zero a real invoice when a customer's stored phone is not
digits-only?

`syncPayerInvoice` is the authoritative money writer. For a phone key it resolves
the payer's own houses with:

```js
const selfSnap = await getDocs(query(collection(db,'jobAddresses'), where('phone','==',key)));
```

`key` is always digits (that is what `custInvoiceKey` produces). `CLAUDE.md`
states in two places that stored phones are **not** all digits-only — "the office
types '(801) 555-0123' and the import keeps it" — and warns by name against
`where('phone','==',digits)` for exactly this reason.

If such a record exists, that query matches nothing, `linked` is empty, and the
`!isPhoneKey && !linked.length` guard **deliberately does not fire for phone
keys** — so the rebuild writes `install: 0` over a real total.

Why this is not simply fixed: the phone-key exemption is intentional and
documented — "so the bill-to change flow can still zero a payer whose last house
moved away." A blanket refusal would break that. Telling the two apart needs a
decision about which is the safer failure.

What is not in doubt: **the query should normalise.** `custByPhoneDigits` is the
established normaliser, and every other matcher in the app strips punctuation
first. But normalising a Firestore `where` needs either a stored digits field or
a client-side pass over the loaded list, which is a change to a money writer and
so is not being made in the same pass as the read fixes.

⚠ **This may be entirely theoretical.** If every `jobAddresses.phone` in the live
book is already digits-only, there is nothing here.

⭐ **AND IT IS NOW ONE PANEL AWAY, 2026-08-26.** Addie chose *check the real data
first*, and rather than hand her a console command that answers it once, the
question is now a Health Check row — **"A stored phone the invoice rebuild cannot
match"** (`phoneNotDigits`). Empty row ⇒ this is theoretical and Q-019 closes.
Non-empty ⇒ it names the customers, quotes what is stored beside the key it misses,
and says whether an invoice with a real total is exposed today.

⚠ **NO FIX BUTTON, and that is the whole question restated.** Two repairs exist and
they are different decisions: normalise the stored phone (changes what the office
reads on every screen and export), or normalise the query. **The second is already
patterned in the same function** — twenty lines above, an email key that fails its
equality query falls back to the loaded `jobAddresses` list, with a comment saying
an equality query cannot match a case difference. That is this failure, in this
function, already solved once for the other branch. It is not applied here because
changing a money writer is its own change with its own red-check.

⚠ **The row deliberately excludes three shapes**, each for a reason a false positive
would cost: a house billed elsewhere (reached by the `billToPhone` query, so its own
phone format cannot hurt it), a customer with no phone (keys by email — the branch
that already has the fallback), and a phone column holding words rather than digits
(same reason). ⚠ That last exclusion **was proved by a red-check to be untested** —
the email-only fixture had no `phone` key at all, so it passed whether the guard
existed or not. A fixture with `phone: 'n/a'` is what actually reaches it.

Blocks: routing any new caller through `syncPayerInvoice` — which is why the
"Use This Total for Their Invoice" button was made to *refuse* on a shared bill
rather than re-sync one.


### ⭐ ANSWERED 2026-08-26

Addie, asked whether to keep waiting on the Health Check row or just fix the query:
**"yes"** — do the query-side fix.

That answer came straight after she said she does not read Health Check
("the design is weird and I can't mark anything as completed or outside of policy",
HC-03). So the row this question was parked behind is not a route to an answer, and
waiting on it was waiting on nothing. The measurement was only ever there to decide
whether the fix was *worth* making; the fix is protective either way.

**What was built.** `syncPayerInvoice`'s phone branch now falls back to the loaded
`jobAddresses` list when the equality query resolves nobody — the identical fallback
the **email** branch twenty lines below has always had, for the identical reason: an
equality query cannot match what normalising would.

- ⚠ **It asks `custInvoiceKey`, never compares phone fields.** Comparing the raw
  strings is the mistake that quietly duplicated the whole book once, and it fails on
  this very fixture. Red-checked.
- ⚠ **Only when the query found nobody**, matching the email branch. **A real gap
  remains and is deliberately not closed here:** a group where *some* houses are
  stored digits-only and some are not still resolves only the digits ones, so the
  formatted sibling is silently left off the bill — undercharging rather than
  zeroing. Making the fallback unconditional is the obvious repair and is a larger
  change to how a live invoice's group is built, so it is its own change with its own
  red-check. **Carried forward as Q-019a.**
- The stored-phone repair (normalising what is written) is **not** done and should not
  be smuggled in: it changes what the office reads on every screen and export.

**What the tests prove.** Suite 10 RUNS `syncPayerInvoice` against a fake Firestore
whose `getDocs` filters on the RAW field, exactly as Firestore does — so the fixture
fails on unfixed code rather than simulating the bug. Three sabotages red-checked.

⚠ **Two of those checks were vacuous until the red-check caught them**, and both are
worth recording because they are the same trap twice. "The payment is not lost"
passed with the bug present, because `existing.deposit` is preserved either way — the
real damage is that the zeroed invoice then computes to **Paid in Full**
(`computeInvoiceStatus(0, 0, 100, 0, 0)`, run not reasoned about), so the payer reads
settled and no chase-the-unpaid send ever contains them. And the first status fixture
still had a sibling house reachable by the `billToPhone` query, so the group was never
truly empty and the status stayed plausible; it takes a payer **alone** to bite.

### ⭐ Q-019a ANSWERED THE SAME DAY — the fallback is unconditional

Addie, shown the four scenarios run side by side and asked whether to widen it:
**"yes"**.

She had first read Q-019a as being about customers with no email; it is not, and the
confusion was my wording. It is **one payer with several houses whose phone is typed
differently on each record** — `8011112222` on one and `(801) 111-2222` on another.
The query finds the digits-only ones, so `linked` was non-empty, the fallback never
ran, and the formatted house was left off the bill. The total **and** `billedHouseIds`
both omit it, so the invoice adds up and is wrong: an **undercharge** nothing
announces.

⚠ **And it is not an edge case.** The real book has ~17 phone numbers shared by more
than one house (the four Anderson houses among them), and those groups are formed by
exactly this match. Q-019 originally deferred this as "its own change"; that was right
about the care needed and wrong about the likelihood, and the deferral note said so
without saying which.

**What was built.** Both fallbacks now run always instead of only when the query
resolved nobody. Safe because `addHouse` dedupes by document id and every house the
fallback can add has already passed the same `custInvoiceKey` rule the query enforces
— it can only ever ADD a house that genuinely belongs on the bill.

⚠ **The EMAIL branch was widened too**, and that is not scope creep: it had the
identical `!linked.length` shape and therefore the identical hole (`dana@x.com` and
`Dana@X.com` on one payer). It was also the precedent the phone fix was copied FROM,
so leaving it conditional would re-create the very asymmetry that hid the phone bug —
"a fix in one direction is half a fix", which this repo already records by name.

**What is still deliberately NOT done:** normalising the *stored* phone or email.
That changes what the office reads on every screen and export, and is a separate
decision.

**Resulting map change:** **MON-23** for the original answer, **MON-25** for Q-019a.

---

## Q-020 · intent · ANSWERED · 2026-08-26
When a house moves onto somebody else's bill, what happens to money the
customer had already paid?

Found by asking what "a house billed elsewhere reads Paid in Full" actually
means, and the display half turned out to be the smaller half.

**The mechanism.** Changing a customer's Bill To rolls their house price onto the
new payer's invoice. Their own invoice must then stop billing them, or the house
is charged twice — so the Edit Customer save deletes it. Unless it carries a
deposit, in which case it is kept and **zeroed** instead, so the recorded payment
is not thrown away:

```js
if(Number(inv.data.deposit) > 0){
  await updateDoc(doc(db,'invoices', inv.id), { install: 0, removal: 0, changeFees: 0, … });
} else {
  await deleteDoc(doc(db,'invoices', inv.id));
}
```

**What that leaves.** A document reading `install: 0, removal: 0, changeFees: 0,
deposit: 150`. Two consequences:

1. `computeInvoiceStatus(0, 0, 150, 0, 0)` is **`'Paid in Full'`** — verified by
   running the real function. Nothing owed, something paid. So that customer
   reads as settled on Automation Emails' payment filters and the Dashboard's
   RSVP list, while the bill their house is really on may be untouched. In the
   narrow sense it is true of *that document*; nobody reading the screen thinks
   "their archived invoice".
2. **The $150 does not follow them.** Only the light-change fee migrates
   (`migratingFeeNotes`). `syncPayerInvoice` rebuilds the payer's invoice from
   house prices and keeps `existing.deposit` — the *payer's* deposit. So the new
   payer is billed the full price of that house with no credit for money already
   paid against it, and the payment sits on an invoice no screen reads.

The code comment says the money "isn't lost". That is true only in the sense that
the document still exists. Nothing collects it.

**ANSWER (Addie, 2026-08-26).** None of the three below. Her rule, in her own
words, across two messages:

> *"if person already paid bill but moved to bill to than person on bill to will
> not have to pay anything and bill to person will just start paying for both
> people the next year"*
>
> On a half-paid house: *"Just pay what hasn't been paid yet"*
>
> And the other direction: *"However if bill to person already paid bill and
> someone was added onto there bill that hasn't paid than they will get another
> bill showing what they still owe"*

⭐ **All three are ONE mechanism: the money already paid follows the house.**
That is what makes it implementable without three branches — if it ever needs
three, the rule has been implemented twice.

| the house that joins | price added | credited | payer ends up owing |
|---|---|---|---|
| fully paid | $350 | $350 | nothing more for it |
| half paid ($150 of $350) | $350 | $150 | the $200 still owed |
| unpaid | $350 | nothing | a fresh $350 |

**Built as:** `paidBeforeBillTo` on the customer, stamped by
`carriedPaymentOnBillToChange` when a house is newly pointed at another payer,
and turned into a named credit line (`kind: 'carried'`) by `syncPayerInvoice`.

⚠ **A credit, not a smaller `install`.** Taking it off the total would stop the
invoice's own rows adding up to the amount printed beside them — the guarantee
`billedHouseIds` exists for — and would make Health Check's `totalDrift` flag
every one. As a credit it also *shows* the customer why a house on their bill is
costing them nothing.

⚠ **Rebuilt, never accumulated.** `syncPayerInvoice` runs on every save; pushing
a credit each time would discount the bill again until it reached zero. It owns
`kind: 'carried'` and keeps every other credit; the Edit Customer save owns
`referral` and `manual` and keeps the rest. The two rebuilds cannot collide.

⚠ **Capped at what that house actually owed.** A deposit larger than the bill is
an overpayment or a typo, and handing the difference to the new payer would be
inventing money.

⚠ **And the Health Check row was retargeted in the same change.** A correctly
handled move still leaves a zeroed invoice carrying the payment — that is the
record of a settled house. So the leftover is no longer the symptom; a leftover
with no `paidBeforeBillTo` on the house is. Left as it was, the check would have
fired on every move it had just been fixed to make safe.

**Resulting map change:** **MON-17**. `paidBeforeBillTo` is a new customer field —
written by the Edit Customer save, read by `syncPayerInvoice` and by Health
Check's `strandedPayment`.

---

**The three answers that were offered and NOT chosen**, kept so they are not
re-proposed:

1. **Credit it to the new payer.** Matches what most people would expect — the
   money was paid toward that house, and the house is now on this bill. But it
   moves a real payment onto somebody else's invoice automatically, and the two
   parties may be a tenant and a landlord who have not agreed to that.
2. **Refund it, or flag it for refund.** Cleanest morally, most work, and needs a
   path that does not exist.
3. **Leave it as a record and handle it by hand.** What happens today, except
   nobody is told it happened.

⚠ **Not guessed, because all three move real money differently.** What has been
built is the *detection* only: Health Check now has a **"A payment sitting on an
invoice that bills nothing"** row (`strandedPayment`), which names the customer,
the amount, and who is paying for them now. It deliberately offers **no Fix
button** — a button here would pick one of the three above without being asked.

⚠ **It does not fire on a prepayment.** Somebody who pays before their house is
priced has the identical invoice shape — no charge, a deposit — and is perfectly
fine. The row appears only when every customer filed under that key now bills
elsewhere, or when nobody is filed under it at all. A warning that cries wolf on
ordinary prepayments is one the office learns to click past, including on the day
it is right.

⚠ **Whether this has ever actually happened is not known from here** — it needs
the real book. Opening Health Check answers it: if the row is empty, this is
theoretical and the decision can wait. If it is not, the rows name the money.

Blocks: nothing shipping. It blocks deciding, which is why detection went first.

⚠ **The paragraph above is kept as it stood before she answered** — it is the
argument for detecting first and deciding after, and it is why there is still no
Fix button on that Health Check row. The ruling that superseded it is MON-16.

---

## Q-021 · intent · answered · 2026-08-26
Should somebody who said Back Next Year still be billed for this season?

Asked because `billingGroupsByPayer`, `syncPayerInvoice` and `runInvoiceBatch`
all excluded only `rsvpStatus === 'no'`, while `isOutForSeason` — which decides
routes, builds and the schedule — has excluded Back Next Year and Maybe Next
Year since 2026-08-22. So those customers were taken off every crew day and out
of the build queue, and still invoiced for the season.

**Answer (Addie, 2026-08-26): no — take them off the bill.**

⭐ **Q-012 is the same rule, asked from the other side, and answered the same way.**
Both were built in parallel and folded into one on the merge — see the comparison
table there. The survivor is `houseIsOnTheBill` (admin.html) /
`houseIsOnTheBillServer` (functions/index.js), swept against each other by
`money-parity.test.js`. Out means `'no'`, or `rsvpStatus === 'backnextyear'` or the
`maybeNextYear` flag **while `completed !== true`** — both halves of Back Next Year,
because `portalRsvp` writes the status alone while the office button also sets the
flag.

⚠ **The `completed` qualifier came from Q-012, not from here.** This branch first
filtered on the answer alone, which writes off a house whose lights were hung and who
only then said Back Next Year. That is `pullCustomerFromSeason`'s settled rule pointing
the other way, and it is the one substantive correction the merge produced.

⚠ **Deliberately not `isOutForSeason`.** That also returns true for
`needsLightRecycle` — a warehouse state, not a decision about money — and, once
`SEASON_ELIGIBILITY` is flipped to `'confirmed-only'` (Q-010a), for every
customer who has not personally answered yes. Billing off that switch would take
the whole book off its invoices on the day it is flipped.

⚠ **The house list follows the money.** `billingGroupsByPayer` applies the same
rule, so the portal box, the `{{houses_block}}` email token and the Edit
Customer house tabs stop naming a house the total leaves out.

**Resulting map change:** **MON-18**, cross-referenced to **MON-15** (Q-012's row) —
two rulings, one implementation. `houseIsOnTheBill` is the one answer to "is this house
billed this season", read by the office rebuild, the nightly run and the group list. It
supersedes the bare `rsvpStatus !== 'no'` test in all of them.

---

## Q-022 · intent · answered · 2026-08-26
When Who Pays for Whom is retired, does its Excel export survive?

**Answer (Addie, 2026-08-26): keep the Excel export somewhere.** The whole-book
view goes with the tab; the export does not.

Not yet built — retirement itself is deliberately after the house tabs have been
used for a season (see CLAUDE.md). Where it lands is a placement decision, not a
rule: the Invoices tab is the obvious home, since that is where the money lives
and where somebody wanting a spreadsheet of who owes what would look.

**Resulting map change:** **MON-20**, recorded as *Decided — not built*. The
ruling is that the export survives the tab; nothing is written until the tab is
actually retired, and a row marked built when it is not is worse than no row.

## Q-023 · intent · ANSWERED · raised 2026-08-27, answered 2026-08-28
Is a crew-day a patch of map, or a town?

**This is a same-tier contradiction between two of your own rulings, so it is
recorded rather than decided** (CLAUDE.md §2: "Two rules in the same tier that
contradict: STOP AND ASK. Do not pick one.").

**The two sides.**

*Map.* 2026-08-22: **"city lines arent a concern."** PR #14
(`claude/grid-blocks-schedule`, head `6621f67`) was built on that ruling. It adds
`js/grid.js` — 718 lines, a file that does not exist on main — and makes the
container for a crew-day a block of map rather than a town. Its own header
argues the case, quoting you again on why it is not simply nearest-twenty:
"we dont end up with a bunch of dots in the middle of no where so we dont have
any one man days... if we base it soley on distance were gonna have a lot of
houses along the outside of the space we cover because they were never in
closest distance." So it lays the whole book along a space-filling curve instead
of packing greedily, specifically to stop rim houses being stranded.

*Town.* 2026-08-24 to 2026-08-26, main went the other way and kept going:
`MAX_TOWNS_PER_CREW`, `townsAreNeighbours`, `DEFAULT_NEARBY_TOWNS`,
`routeDayTowns`, `cityLooksLikeStreet`. `byCity` is still the container on main
(40 mentions), and the one-crew-one-town rule rests on it.

**Why it cannot be settled from the code.** The *ruling* for map is newer
(the 22nd); the *code* for town is newer (the 24th–26th). One of the two was
left behind and nothing in the repo says which. PR #14 was never merged and
never closed, and it has no merge base with main any more — main was rewritten
after it was opened — so it is not decaying quietly in a way anybody would spot.

**What is blocked.** Whether PR #14 is ported forward or closed. Nothing else:
the town model works today and the season builds. This is not urgent, it is
just undecided, and an undecided question about how the whole season is grouped
is worth having written down.

**What each answer costs.** Porting the grid touches the crew split, the
near-empty-day rescue, One Man Installs and both printed sheets — all of which
had owner-driven changes *after* #14 was written, so it is a real piece of work
rather than a merge. Closing it loses the rim-house argument, which no rule on
main currently answers; the branch would stay intact and revivable.

**UPDATE 2026-08-27 — the decay is off the table, the question is not.**
`js/grid.js` is now on `main`, unwired, with `grid-parked.test.js` running it on
every build (questions map PROC-22). It was the only file that existed solely on
that branch, it is pure arithmetic with no DOM and no Firebase, and it conflicts
with nothing — so the thing that was getting more expensive by the day was never
the file, it was the six wiring commits around it. Those still have to be redone
against today's admin.html whenever this is answered, and that cost is unchanged.
What this removes is the pressure to answer quickly to avoid losing the work.

**Resulting map change:** `SCH-25` in `claude/questions-map.md`.

---

### ⭐ ANSWERED 2026-08-28 — a patch of map

Addie, asked directly whether it matters that a crew's houses are all in one
town: **"what matters is that all the houses are next to each other. So if there
not all in Lehi that is okay just as long as the houses are next to each other."**

So adjacency between HOUSES is the rule and the town name is not. The 2026-08-22
ruling stands and the town model is superseded *where it tests a town name in
place of a distance*.

⚠ **THE TOWN RULINGS ARE NOT WRONG AND ARE NOT BEING THROWN OUT.** Everything she
asked for between the 24th and the 26th is still what she wants — one crew
working one area rather than criss-crossing the valley, never a three-town day,
never a rim house stranded on a one-man day. Those were expressed as town rules
because a town was the only container the builder had. What changes is the TEST:
from "is this the same town, or a listed neighbour" to "are these houses near
each other". A crew doing eleven houses in Lehi and nine in American Fork, all
within a few streets, satisfies her answer and would be REFUSED today.

⚠ **AND THE ANSWER IS NARROWER THAN "MERGE PR #14".** What she ruled on is the
container for a crew-day. The six wiring commits on that branch also touched the
crew split, the near-empty-day rescue, One Man Installs and both printed sheets —
all of which she changed AFTER that branch was written. Those changes are hers
and are newer; they are not part of what this answers. Porting has to bring the
container across and leave the rest alone, which is why this is a piece of work
rather than a merge.

⚠ **WHAT A SHEET STILL HAS TO SAY.** A crew-day that is no longer one town still
prints; `crewCityFor` joins a crew's towns into a label and `routeCityOf` reports
a majority town. Neither can be deleted without deciding what the sheet says
instead — "Lehi + American Fork" is honest, a bare block number is not. Not
answered here; it is the first thing to put to her when this is built.

⚠ **AND `stopProblem` EVICTS ON A TOWN MISMATCH.** That sweep runs every five
minutes and it is what makes a mixed-town day safe today (see CLAUDE.md, "the
thing that makes it safe"). It must be moved to the same distance test in the
SAME change, or the builder will place houses the sweep then evicts, for ever —
the build-evict-rebuild loop this repo has already had twice.

---

## Q-024 · intent · answered · 2026-08-28
The ×2.9 pricing multiplier was compensating for a fault that is now gone. Does it stay?

**This is money on every quote, so it is recorded rather than decided.**

**What it is.** `RM_FEET_MULTIPLIER = 2.9` in admin.html, set on your own
instruction on 2026-08-26: *"make it so a foot is 2.9 times smaller than it
currently is, so 50 feet would be a little under 150 ft instead."* Measured feet
are shown as measured; the PRICE is worked out from `feet × 2.9`, and both
numbers are on screen as separate lines.

**Why it is being raised now.** The comment above that constant already said
this would have to be revisited, in as many words:

> ⚠ SO WHAT IT IS COMPENSATING FOR IS WHERE THE DOTS LAND, not how they are
> measured, and that has a real cause being worked on: dots were landing about
> 6.7 ft from the truth on 209 S 850 W … If the model displacement work lands
> that error properly, **THIS NUMBER MUST BE REVISITED — leaving 2.9 on top of a
> fixed measurement would inflate every quote by nearly three times.**

That is what happened. The displacement it compensated for came from projecting a
sky dot into Street View, and Street View no longer places or receives dots at
all (MR-01). A distance between two sky dots is plan distance on one picture,
which is the one measurement that was never in doubt — the same argument that
retired the alignment: a displacement shared by every dot cannot change the
distance between two of them.

**What it does today.** Measured on the real Lehi house on 2026-08-28: a traced
outline came to **134 ft**, and the price was worked out from **389 ft**. At
$2/ft that is $778 rather than $268.

**The three answers.**

1. **Set it back to 1.** Correct if the sky-view measurement is now true. Every
   quote falls to roughly a third of what it reads today.
2. **Leave it at 2.9.** Correct if real rooflines still measure short — the
   overhead trace follows the gutter you can SEE, and a house with a deep porch
   or heavy tree cover may genuinely need more string than the outline suggests.
3. **Re-measure a house you know the real footage of, and set it from that.**
   The honest version of (2): the multiplier stops being a guess and becomes a
   number with a house behind it.

**What is NOT in doubt:** the arithmetic. `rmFeetBetween` was driven directly —
two points 10 m apart report 32.808 ft against a true 32.808. This is not a
metres-read-as-feet bug and never was.

**Recommendation: (3), on two or three houses.** (1) is only right if the trace
is true, and nobody has checked a traced outline against a tape. Until it is
answered the multiplier is left exactly as it is — changing it silently in either
direction moves every price you quote.

**ANSWERED 2026-08-28 — it stays.** Owner: *"yes the 2.9 is good because we want
to charge $2 a foot but if the house is so called 60 feet we cant do that so we
might want to adjust the 2.9 and if we do ill let you know but for now lets keep
it."*

⭐ **SO IT IS NOT A MEASUREMENT CORRECTION ANY MORE — IT IS THE RATE.** That is
the part worth writing down, because the constant's own comment still describes
it as compensating for where dots land, and that reason is gone. What it actually
carries now is a business fact: $2 a foot is the advertised rate, and a 60 ft
house cannot be done for $120 whatever the tape says. The multiplier is where the
minimum-job cost lives.

⚠ **DO NOT "FIX" IT BACK TO 1 WHEN THE MEASUREMENT IS PROVED TRUE.** That is the
trap this answer closes: a future session finding an accurate trace and a 2.9
sitting on top of it will read it as the stale compensation the old comment warns
about, set it to 1, and cut every quote to a third. It survives the measurement
being right.

⚠ **AND IT IS HERS TO MOVE.** She has said she may adjust it and will say so.
Nobody changes this number without her.

**Resulting map change:** MR-08 in `claude/questions-map.md`.

---

## Q-025 · intent · PART-ANSWERED · raised and part-answered 2026-08-29
A card is charged and no invoice can be found to apply it to. Where should that show, and who may clear it?

**This is real money that is currently invisible, so it is recorded rather than
guessed at.** Found while working the instruction to *"make sure there all
accurate, and there all there along with marking were the errors or holes are
at"*.

**What happens today.** `recordUnmatchedPayment` in functions/index.js files the
capture in `unmatchedPayments` and texts the office, if an alert number is set.
The usual cause is the phone or email the bill is keyed on having changed since
the invoice was written.

**Three things are then true at once, and each was checked rather than assumed:**

1. Nothing anywhere writes `resolved: true` — the field is written `false` once
   and never moves.
2. **No screen in admin.html reads `unmatchedPayments` at all.** The collection
   is invisible in the app.
3. `firestore.rules` line 169 says `allow write: if false`, so even a screen that
   existed could not mark one dealt with.

Meanwhile the customer's own portal reads **Paid in Full**. The money is real,
correctly captured, and in a place with no way in and no way out.

**Why it is not simply built.** Two answers are needed and neither is mine:

- **Where should these show?** Health Check is the obvious place and is the wrong
  one — HC-03 records that it is not read, and that adding a row there is how a
  finding gets buried rather than reported. The Invoices tab is where money lives.
- **Who may clear one, and what does clearing mean?** Applying it to the right
  invoice, refunding it, or simply marking it seen are three different answers
  about somebody's money. And letting the office write to that collection needs a
  `firestore.rules` change — which **CI does not deploy**; it needs
  `firebase deploy --only firestore:rules` by hand.

**What was done meanwhile.** It is drawn on Connections › The path as an ending,
marked not built, saying in as many words that there is no way out of the state.
That makes it visible without pretending a repair exists.

**PART-ANSWERED, 2026-08-30** — *"Put that in health check."*

**Where they show is settled and built.** A Health Check row, `unmatchedPayment`, naming
the amount, the number it was paid on, and who on file has that number now. It reads the
collection (staff may read it; only writing is forbidden) and reports nothing at all if
that read has not landed.

⚠ **The Invoices tab was argued for and she chose Health Check.** The objection was HC-03,
and it is largely spent — approve/deny shipped on 2026-08-27, so a row can be cleared.

**What clearing means is still not fully answered, and did not need to be to ship this.**
There is no Fix button: applying it to the right invoice, refunding it, or marking it seen
are three different answers about somebody's money. **"Not a problem" gives her the third
one today**, and it writes to `healthCheckDecisions` rather than to `unmatchedPayments` —
so the collection stays write-forbidden and **no `firebase deploy --only firestore:rules`
is needed**, which was the other cost this question was carrying.

**FURTHER ANSWERED, 2026-08-30** — *"we need unmatched invoice to come up in system inbox
before we send it out."*

**Timing was the half Health Check could not cover.** A capture that lands at eleven at
night and an invoice that goes out at seven the next evening pass each other with nothing
said, because Health Check is a panel somebody has to open. Offered the choice between
**holding the invoice back** and **noting it and warning on the invoice screen**, she chose
the second.

- `recordUnmatchedPayment` posts a **System inbox note** when the capture is filed, deduped
  on the capture id, wrapped so it can never unwind a successful capture.
- `renderUnmatchedPaymentBanner` warns at the top of the **Invoices tab**, naming the
  customers the payment might belong to.

⚠ **The bill is deliberately NOT held.** A payment we cannot match is our bookkeeping
problem; stopping somebody's invoice over it means a customer who has done nothing wrong is
not billed at all.

**Still open:** whether one of these should ever be *applied* to an invoice from here, and
by whom. That is a real money decision and is not urgent while three surfaces make them
visible.

**Resulting map change.** MON-29, and MON-30 for the inbox note and the invoice banner.

---

## Q-026 · intent · ANSWERED · raised and answered 2026-08-29
Should Start New Season clear `removalDone`, the way it clears `completed`?

**This is a change to Start New Season, which is on the short list of things
that need you rather than a judgement call, so it is recorded rather than made.**

**What happens today.** The reset clears `completed`, `invoiceEmailSent`,
`scheduled`, `scheduledDate`, `assignedCrew`, `chargeNewMemberFee`,
`needsDayAssignedAt`, `rejoinedForSeasonAt` and `cameBackThisSeasonAt`. It does
**not** clear `removalDone` or `removalDoneAt`, and nothing else ever does —
`grep` finds exactly one writer of `removalDone: false`, the Mark Done toggle
being un-ticked by hand.

**So a customer whose lights were taken down last December reads "Removed" all
the way through the new season**, until somebody visits the record and unticks it.

**Why it looks like an oversight rather than a decision.** `completed` and
`removalDone` are the same shape of fact — a job done this season — and the
comment on that write explains why each of the other eight is cleared. This one
is not mentioned.

**Why it is not simply fixed.** Start New Season rewrites every customer in the
book in one press and cannot be undone. If `removalDone` is season-scoped it
should be cleared with the rest; if it is meant to persist — because a bin that
came back stays back until the crew take it out again — then clearing it would
tell the warehouse a set is out that is not. **I do not know which, and guessing
wrong is a real crew journey.**

**What was done meanwhile.** Nothing to the reset's behaviour. It now also
stamps `seasonResetAt` on each customer — purely additive, read only by the
customer history, which draws a line at that date so last season's dates stop
reading as this season's. That was the visible symptom; this question is the
underlying one.

**ANSWERED, 2026-08-29.** *"Oh so if we removed lights from someone's house that should
reset for new season."* Yes — it is season-scoped, so it now clears alongside `completed`
and the other eight, **in the same write** (a separate one can fail on its own and leave
half the book reset). The **date** is deliberately kept: `removalDoneAt` says when last
season's takedown happened and the history needs it, while the flag says what is true of
the season starting now.

**Resulting map change.** SCH-35.

## Q-027 · intent · ANSWERED · raised and answered 2026-08-29
Should an existing member who approves a re-quote fill in the install-details
form, the way a brand-new customer does?

**Two of your own answers point opposite ways, and I have not applied either
because the newer one may be an observation rather than a decision.**

**2026-08-19, a ruling:** *"I need the members that already exist not to go to
the form once they are created. It should just show a message similar to Do you
want anything changed with your lights this year? If they say yes they will go
straight to there member portal if they say No than a cute message will come
up."* That is what the code does, and the reasoning is written into it: a member
already has their colours, wire, timer and gate code on file, so the form asks
them to re-type what we hold.

**2026-08-29:** *"You mean that only requotes see the quote form cause everyone
should be filling out the form, but when I checked last everyone that gets an
email and pushes approve does fill out the form with all info."*

**The factual half is resolved, and both of you are right.** Who sees the form
is decided by `alreadyMember`, which is true only when the quote carries
`convertedToCustomerAt` (staff-only) or an `existingCustomerId` pointing at a
record that still exists. So:

- a **brand-new lead** approving → gets the form. Always has.
- an **existing member** approving a re-quote → is asked what is changing.

A test quote is a new lead, so *"when I checked last, everyone fills the form"*
is exactly what you would see. Nothing is broken and nothing contradicts the
code; the two answers are about two different people.

**The intent half is yours.** Should the second group get the form as well?

- **Keep it as it is** — a member re-typing colours we already hold is how a
  record gets *worse*, and the "do you want anything changed" question is
  shorter and answers the same thing.
- **Give everyone the form** — one path instead of two, and a member whose
  details are stale gets a chance to correct them. The cost is that a member who
  changes nothing can still overwrite good data with a hurried re-entry.

**Why it is not decided here.** R-024 says your newer answer wins where you have
answered the same question twice — but the newer line reads as *"I thought it
worked this way, and when I tested it, it did"*, which is a report rather than a
ruling, and applying it would undo a decision whose reasoning is still sound.
Saying so and asking is the rule for a same-tier collision, not picking one.

**Nothing was changed either way.** The journey page draws both routes, so the
two paths are at least visible now.

**ANSWERED, 2026-08-29** — *"Requotes work different we should just have a fill out
form or keep info already in system kind of thing... So give them an option if that makes
sense."*

**Give them the option — and it already exists**, which neither of us knew when the
question was written. `offerMemberChangeChoice` renders **three** buttons to a member
approving a re-quote:

1. *"Yes, I'd like to make a change"* → their own portal
2. *"Fill everything in again from scratch"* → **the form**, pre-filled from what we hold,
   greeting them with *"Here's what we have on file — change anything that's different this
   year."* It is the same form and the same submit a brand-new customer uses.
3. *"No, keep everything the same"* → done

**So nothing was built for this, and nothing needed to be.**

⚠ **My own framing of this question was incomplete and that is what made it look like a
fork.** It described the member branch as *"asked what is changing"* and did not mention
the middle button — so the choice read as form-versus-question when the form was already
one of the three answers.

⚠ **And the questions map said `Decided — not built` for QT-17, which was stale.** A status
column that has gone stale is worse than a missing one: it sent this session towards
designing something that already shipped. Corrected at the code, not from the row.

**Resulting map change.** QT-17, re-confirmed and its status corrected.

---

## Q-028 · intent · ANSWERED · raised and answered 2026-08-30
Two flags are sent to the customer's own page so it "cannot contradict the office", and the page never looks at either. Should it show something, and what?

**Found by sweeping the code back to the whitelist**, working the standing
instruction to *"make sure there all accurate, and there all there along with
marking were the errors or holes are at"*. Every existing check about
`PORTAL_READ_FIELDS` asks *"is this listed field correct?"*, so a claim about a
field that nothing reads is absent from the question rather than answered
wrongly — the same blind spot the dated-field census hit on 2026-08-29.

**What is true today, and each half was checked rather than assumed:**

1. `askSameAsLastYear` is in `PORTAL_READ_FIELDS`. Its comment there says it is
   in the list *"so the portal cannot contradict the office about a question
   that is still open"*. **The string appears nowhere in `index.html`.**
2. `cannotBillNoEmail` is in the list. Its comment says it is there *"so the
   portal cannot show a customer as settled while the office is chasing them for
   an address"*. **The string appears nowhere in `index.html`.**

So both flags arrive at the browser on every sign-in and nothing reads them. The
portal can contradict the office about a re-quote somebody declined, and it can
show a customer as settled while the office has no way to bill them — exactly
the two things the comments say cannot happen.

**Nothing is broken and nothing leaks.** These are the customer's own flags and
sending them costs nothing. What is wrong is that two comments and two test
failure messages describe a protection that was never built, which is the
**P-001** shape — a rule stated as fact about a guard that does not exist. Read
by the next person, they close the question rather than opening it.

**Why it is not simply built.** Both would change **what a customer sees on
their own page**, and the wording is the whole of it:

- The re-quote one is a customer who **declined** a new price. Saying *"we are
  checking whether last year's setup will do"* is reassuring; saying nothing
  leaves them thinking they have no lights this year; saying the wrong thing
  invites a cancellation. Only Addie can pick.
- The billing one is more delicate still. The customer has done nothing wrong —
  we do not have an email for them. A line reading *"we cannot bill you"* on
  their own account page is alarming and would generate calls; but showing them
  a clean, settled-looking page while the office is chasing them is the state
  the comment says must not happen.

Neither is urgent: the office side of both works, and this is about a message the
customer might see, not about money moving.

**What was done meanwhile.**

- The two run-all.js failure messages were corrected to say what they actually
  prove — that the field *can reach* the browser, not that anything acts on it.
- `portal-fields.test.js` holds a declared `WHITELISTED_UNREAD` list naming all
  six whitelisted-and-unread fields with what is and is not true of each, so the
  next one is visible rather than silent.

⚠ **The fields stay whitelisted.** Dropping them would make building the portal
half a two-surface change with a Cloud Functions deploy in it, for no benefit
today.

---

**ANSWERED, 2026-08-30** — *"Okay make a protection"*.

Both are built. The wording is mine and she can change any of it; what follows is
the reasoning behind each choice so a change is made knowingly.

**No email on the bill** — a notice at the top of the invoice card
(`renderNoEmailNotice`):

> **We do not have an email address for you.**
> That is the only reason your invoice has not arrived — nothing is wrong with
> your account. Add one on the **Your Details** tab and we will send it straight
> over, or call us on (801) 901-0011 and we will take it down for you.

- **It asks for the address rather than announcing a problem.** "We cannot bill
  you" is alarming to somebody who has done nothing wrong and gives them nothing
  to do about it. What they can act on is adding an email, so that is what it
  says — and the sentence saying nothing is wrong with their account is doing
  real work, not padding.
- **The person reading it is the one who can fix it.** The nightly run checks the
  whole bill for an email before setting the flag, and sets it on the **payer** —
  so a house billed to somebody else never carries it, and this can never tell a
  tenant to go and fix their landlord's record.
- **It is derived, not just stored.** The flag is only cleared by the next
  nightly pass, so between typing an address and 7pm a stored-only reading would
  keep nagging somebody who has already done what was asked. If the record now
  has an email the notice hides itself whatever the flag says — the same
  stored-flag-derived-display shape the office tag already uses.

**A declined re-quote still open** — a branch in the schedule strip:

> 📝 Thanks for letting us know about the new quote — we're working out whether
> last year's setup will do. Nothing needed from you; we'll be in touch.

- **It says the ball is with us.** Nobody has asked them for anything; somebody in
  the office has to decide. Asking them to act would be inventing a job for a
  customer who has already answered.
- **It replaces a promise we had not made.** The line it displaces read *"You're
  on the list for this season. We'll be in touch with your install date"* — an
  install date, for a season they are not booked for.
- **It sits below the scheduled-date branch.** A house with a date has been
  decided in practice whatever the flag still says, and telling somebody holding
  a date that we are still working it out is the same contradiction pointing the
  other way.

⚠ **Both are RUN against jsdom, not matched in the source.** Every claim here is
about a line on a page, and this repo has been caught three times by a check that
matched the source of a message which could never reach the screen. Ten sabotages
red-checked, ten caught.

**Resulting map change.** PR-07.

