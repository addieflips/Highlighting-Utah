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

## Q-010 · intent · part answered 2026-08-22 · Q-010a still open
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

⚠ **Still worth deciding (Q-010a's companion):** the Dashboard RSVP panel counts
`rsvpStatus === 'yes'` — status alone — so assumed yeses are counted as confirmed
there. That is the number most likely to be read when judging *"has everyone been
asked yet"*, i.e. the input to Q-010a. Left alone rather than changed silently: it
is a status tally, and whether it should show replies-only is a display decision,
not a correctness one.

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

Blocks: the flip itself, which is tier 1 — getting it wrong means nobody is
scheduled.
Answer: Q-010b answered 2026-08-22 — a reply is required; assumed yes does not
count. Q-010a (the date) still open.
Resulting map change: `isOutForSeason`'s `confirmed-only` branch now requires
`rsvpRespondedAt`; asserted against the Yes-tab predicate so the two cannot drift.

---

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
