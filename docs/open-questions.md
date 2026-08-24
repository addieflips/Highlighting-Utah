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

---

## Q-012 · intent · answered · 2026-08-24
When an option has no answer, what word should the printed sheets use — `none`,
`?`, or an em dash?

**Blocks:** nothing. `none` is shipped. This is a one-word change if the answer
differs, and it is asked because it changed paper the crew reads.

**Why it is being asked.** Before Phase 1, one crew sheet carried THREE spellings
of "we have no answer", each with its own reasoning written down beside it:

- `?` for a yes/no. Addie, 2026-08-21, and her reasoning is the strongest of the
  three: a defaulted "No" is a question answered on the customer's behalf, and
  `?` is the master sheet's own word for it — the Up Plug column holds 112 yes,
  98 `?` and 61 no, so the office already writes a question mark when nobody has
  asked.
- an em dash for the gate code, argued in the code as: the record cannot tell
  "no gate" from "there is a gate and nobody asked", so a confident `none` claims
  a fact we do not have.
- an empty cell for the bin count — which is the one nobody defends, and is
  exactly the silence R-002 exists to stop.

**What was shipped, and why.** `none`, everywhere, from one place. R-002 names
that word, plan §3.4 names it, and the existing gate test asserts it literally.
All three spellings mean the same thing operationally — never blank, never a
defaulted answer — so the tie was broken on the written rule rather than on
taste. The gain is that there is now ONE spelling in ONE place (`display()` in
`js/options.js`) instead of three in three files.

**What it costs.** `none` on a yes/no is weaker than `?`: a tired reader can take
"Timer: none" as "no timer" where "Timer: ?" cannot be misread. That is a real
loss on the one sheet the crew actually works from, and it is the reason this is
being asked rather than assumed.

**Answer (Addie, 2026-08-24): it depends which field is blank.**

> "It depends on what is left blank. If it's timer than no if its color wire than
> we choose. If it's light colors that needs to be required and they can't move on
> without that."

So the question was mis-scoped: it asked for ONE word, and the right answer is a
different one per option. That is what `default` on an option already means, so
the answer needed no new mechanism — only three declarations:

| Field | Blank means | How it is declared |
|---|---|---|
| Timer | **No** | `default: 'No'` on `outletTimer` |
| Wire colour | **we choose** | `default: 'Any'` — already declared, now honoured everywhere |
| Light colours | **cannot proceed** | `required: true`, no default → `blockingAnswers()` |

⚠ **This REVERSES the 2026-08-21 rule for the timer**, which said a blank meant
"nobody has asked them" and must never become a confident No — on the grounds that
a customer who wanted a timer and was never asked would silently not get one. That
argument is kept in `js/options.js` beside the new default. She was shown it in
full and chose No anyway; newer instruction wins, and it must not be quietly
restored.

⚠ **Nothing is written to any record.** The default is applied at render time by
`valueOf()`. The "Never answered" audience in Automation Emails reads the raw
field (`!m.data.outletTimer`) and still finds exactly the people nobody has asked,
so she can still go and ask them. Defaulting in the DATA would delete that list —
a worse loss than the paper being vague, and the suite now asserts that filter
still reads the raw record.

⚠ **Only the three she named.** `useEaves` and `specificOutlet` are also yes/no
questions and she did not mention either, so both still render `none`. Defaulting
them on the strength of this answer would be the guess this rulebook exists to
stop. `useEaves` was asked as Q-014 and confirmed as `none`.

⚠ **CORRECTED 2026-08-24, same day.** This entry first recorded an exception: the
warehouse build sheet would keep saying **White** for a blank wire, on the
reasoning that somebody there has to take a spool off a shelf so "we choose" has
to become an actual colour. She overruled it — *"we want build a sheet if they
didn't put a wire to read any"* — and she is right: **White** on a build sheet is
indistinguishable from a customer who ASKED for white, and "this one is free" is
the one fact on that row worth having. `whWireLabel` answers `Any` now, which is
the single place the group key, the on-screen chip and both build sheets all
read, so none of them can drift from the others.

⚠ **It splits one warehouse group in two**, and that is the visible cost of the
correction. A house that asked for white and a house that said nothing used to
batch together — both read "White wire" — and now form separate groups. Both are
still built the same way. If the office would rather they stayed one batch, the
fix is `whGroupKey` normalising a blank to White for the KEY while `whWireLabel`
keeps saying Any for the EYE: one line, and it is her call.

**Resulting registry change:** `outletTimer.default = 'No'`; `blockingAnswers()`
added, derived from `required` + no `default` rather than from a list, so the rule
is not written down twice. The quote form now REFUSES to submit without light
colours instead of warning.

---

## Q-013 · intent · answered · 2026-08-24
The crew sheet now prints a Bins column that the frozen AGREED map said it should
not. Confirming that is what she wants, since the map is the record of her
answers.

**Blocks:** nothing — it is shipped, and it matches the sheet the crews have been
given since 2026-08-22.

The AGREED map in `options-audit.test.js` was frozen on 2026-08-21 and lists
`numberOfBins` as reaching the customer record, the pull list, routes and the
schedule — not the crew sheet. On 2026-08-22, the day AFTER, she asked for "crew
print sheet should also show bin #", meaning a quantity (her own vocabulary from
the day before: "Bin # is how many bins were making for them"). The sheet has
carried the column since. So the registry was the half that was out of date, not
the paper, and wiring the sheet to the registry without amending the map would
have DELETED a column the crew uses to load the van.

The map was updated, deliberately and with the reasoning written in beside it.
It is raised here because that file says in as many words: "Update it when she
changes her mind, never to make a red run go away." This was the first kind and
not the second, but the file is right that it should be said out loud.

**Answer (Addie, 2026-08-24): "Yes bin # should show on crew list."** Confirmed —
and then corrected later the same day, which is the part worth reading.

⚠ **THE FIRST READING WAS WRONG AND IS RECORDED HERE SO IT IS NOT REPEATED.** It
was taken as a QUANTITY — how many bins the van loads — on the strength of her
2026-08-21 vocabulary ("Bin # is how many bins were making for them"), and
`numberOfBins` was added to the crew sheet with the frozen AGREED map updated to
match. Hours later: *"The cosumer # and bin # are the same thing."* On the CREW
sheet "bin #" means the number **painted on the bin**, which is the customer
number — and that column already existed. Two number columns would have been two
answers to one question.

The vocabulary differs by sheet, which is what made this easy to get wrong:

| Sheet | "Bin #" means |
|---|---|
| Warehouse build sheet | how many bins they are making — a quantity |
| Crew sheet | the number on the bin — an identifier |

⚠ **AND ON 2026-08-24 THE SECOND NUMBER WAS RETIRED ALTOGETHER.** Asked what the
difference between the two numbers actually was, and shown that they are the same
for almost everybody and differ only when a customer's number moves after their
bin is labelled, Addie's answer was: *"get rid of bin #'s and keep costumer #'s."*
`binLabelNumber`, `whBinNumberFor` and `whBinNumberMoved` are gone, along with the
"bin says" correction box. **A moved number now means the bin gets relabelled** —
one number in the software, one number on the box, and they are the same number.

The trade, stated plainly: nothing warns anybody that a bin on the shelf is
wearing an old number, except the toast shown when a re-quote is converted, which
names both numbers. Any bin already carrying an old label needs relabelling by
hand. The stored `binLabelNumber` values were left on the records — inert, and a
mass write over live customers is hers to press — so every reader is tested
against a record that still carries one.

**Resulting registry change:** `numberOfBins` is back to
`customer, pullList, routes, schedule` — the frozen map was right all along.
What DID change, and is the fix the instruction was really asking for: the crew
sheet's Cust # column now reads `whBinNumberFor` rather than `customerNumber`, so
a customer whose footage moved them into the 5000 series sends the crew to the bin
physically on the shelf, still wearing the old number.

---

## Q-014 · intent · answered · 2026-08-24
When "Plugs / eaves" is left blank, does it mean **No**, or does it mean nobody
has asked?

**Blocks:** nothing. It renders `none` today, which says plainly that we have no
answer.

Q-012 settled the timer (No), the wire colour (we choose) and the light colours
(required). `useEaves` is the fourth field of that shape and was not mentioned, so
it has been left alone rather than defaulted by analogy with the timer.

There is a reason to think it may want a different answer from the timer: the
master sheet's Up Plug column holds 112 yes, **98 "?"** and 61 no, so for this
particular question the office has been recording "nobody has asked" as a real,
common state — on roughly a fifth of the book. Turning all 98 of those into No
would be a decision about 98 real houses.

**Answer (Addie, 2026-08-24): "Okay for eaves that can read none that's fine."**

It means nobody has asked. `useEaves` keeps no default and keeps rendering `none`,
so the 98 question marks in the Up Plug column stay what they are — an open
question about 98 houses, not 98 refusals.

**Resulting registry change:** none. The absence of a `default` on `useEaves` is
now a recorded decision rather than an omission, which is the difference between
a gap and an answer.

---

## Q-015 · intent · answered · 2026-08-24
Phase 2 is mostly superseded by answers already given. What, if anything, should
replace the two parts that cannot be built?

**Blocks:** nothing today. The part of §4 that survives is built and shipped.

Plan §4 has three parts. Checked against the code and against her own earlier
answers before building:

| Plan | Status |
|---|---|
| §4.2 pre-install confirmation, Twilio, N days ahead | **Moot.** Q-005: *"This is for emails we don't have twillo and this would be for RSVP emails."* No new send path, no scheduler, no N. |
| §4.2 / §4.4 `confirmationStatus` pending / confirmed / **disputed** | **Superseded.** Q-006: there is no disputed state; `portalRsvp` accepts only `yes` / `no` / `backnextyear`, and R-005 was retired for guarding a condition the system cannot produce. A catch-all "something is wrong" reply was considered and explicitly rejected. |
| §4.2 record that it was sent, and what was sent | **BUILT.** This is the half that was genuinely missing and is not superseded by anything. |
| §4.3 per-option crew check-off at completion | **Cannot be built this season.** The crew portal is out of use — *"were not using the employee portal this year… we are only printing on schedules and warehouse."* |
| §4.4 confirmation status in the nightly Twilio summary | **Moot**, same reason as §4.2. |

So the question is only about §4.3. Its stated purpose is to produce the
*installed* column that plan §5.2's nightly reconciliation needs — without it,
reconciliation can only compare **ordered vs scheduled vs pulled**, three columns
of four.

Three ways it could come back, none of them free:

1. **Nothing.** Phase 3 reconciles three columns. It still catches an option that
   was ordered and never reached a sheet, which is most of the value.
2. **A tick box per option on the printed crew sheet**, keyed back in afterwards.
   That is real paper work for the office every evening, and the sheet is already
   at ten columns on landscape paper.
3. **Bring the crew portal back for this one screen.** Biggest change, and it was
   dropped for a reason.

⚠ Not guessing between them, because the wrong one costs either a season of
evening data entry or a portal nobody uses. Option 1 is what is shipped by
default — the reconciliation simply runs with three columns.

**Answer (Addie, 2026-08-24): option 1 — and the question was built on a wrong
premise, which is the more useful half.**

> *"timer doesn't need to reach the crew sheet this is warehouses job."*

The example the question was built on — *did the crew fit the timer?* — is not a
failure that can happen. **The crew does not fulfil options at all.** Everything a
customer asks for that becomes a physical thing (colours, wire, timer, bundle
count) goes IN THE BIN, and the warehouse puts it there. The crew hangs what they
are given.

So the *installed* column was never the crew's to provide. The question "was this
option actually supplied" is answered by the **warehouse build**, which already
has a queue, a Mark Done, and a printed sheet. §4.3 is struck: there is no crew
check-off to build, this season or any other, and no crew portal needed for it.

**Resulting map change:** plan §5.2's four columns become **ordered → scheduled →
built**, with the warehouse's own build record as the third. §4.3 is struck.
A knock-on: the crew sheet was carrying Timer and Bins for no reason, and both
came off — see Q-016.

---

## Q-016 · intent · answered · 2026-08-24
What belongs on the crew sheet?

**Answer (Addie, 2026-08-24), asked and answered in her own words:**

> "the crew just hangs they don't need to know what's going in the bin just bin #,
> any notes, addreess, name and for new houses need the new house pictuer and
> fixes need teh fix picture. If they use eaves which will only show if they say
> yes. Than if they want a specific outlet? So things that have to do with the
> house itself."

And, asked what she might be missing, on Sides, Gate, City and Phone: *"Yes those
are important to put on there to."*

**The sheet is now:** Cust # · Name · Address · City · Phone · Gate · Sides ·
Notes, with new-hang and fix photos underneath. Notes carries `EAVES:` (only on
yes), `OUTLET:`, `TODAY:` and the standing note.

**The rule behind it, which is the reusable part:** the crew sheet answers
questions about **the house** — where it is, how to get in, how much of it to
light, what is unusual about it, who to ring. Anything about **what goes in the
bin** is the warehouse's and belongs on the build sheet. That single test is what
took Timer and Bins off, and it is what any future column should be measured
against.

**What was found while doing it, and had been missing all along:** the **fix
photo**. `fixPhotoUrl` and `fixNote` have been on the customer record and visible
in the office note editor for some time, and the crew sheet only ever printed
photos for NEW HANGS — so a crew sent out to fix something arrived with no picture
of what was wrong. Exactly the shape of the gate-code hole P-003 was proposed
about: the data exists, reaches one screen, and never reaches the paper the crew
is holding.

**Resulting registry change:** `outletTimer` and `numberOfBins` both lose
`crewSheet`; `useEaves` gains `foldInto: 'notes'` with a value that is only
present on yes. Cust #, Phone, Address and City are identity, not options, and
stay written out in `PRINT_COLUMNS.crew`.

---

## Answered 2026-08-24 — why a bundle is being built (warehouse badges)

Addie: *"There should be a badge by each person on warehouse that say's new,
Old-Rebuild or Member Poral or Request / New is a new quote / Old-Rebuild is
someone who was already a member that changed address or extended house or added
on a building / Member Portal_ Anything that got changed in member portal /
Request- We added on ourselves based on request we received."*

**Built.** A coloured badge leads the chips on every warehouse build row, from
`whHouseFactsHtml` — the one function the build groups, the blocked block and the
add-on rows all call, so no row type can be missed.

**What had to be built first, and is the real finding:** *nothing recorded where
a colour change came from.* Two of her four badges — Member Portal and Request —
are the same event from opposite directions, and both the portal and the office
wrote `lightsChangedAt` and nothing else. The badge would have rendered the same
answer for everybody and looked authoritative doing it. `lightsChangedVia` is now
stamped at all three write sites: `'portal'` on both of `portalSave`'s writes,
`'office'` on the Edit Customer save.

**And a second one, smaller:** `requoteKind` — how the office answered "what kind
of re-quote is this" — lives on the **quote** document, which a customer record
cannot reach. The badge read it off the customer and so saw `undefined` every
time, meaning it could not tell a house that moved from a price that was
corrected. It is copied onto the customer at the one moment both are in hand
(applying the re-quote). The quote stays the source; this is a stamp of what was
answered, not a second place to change it.

**Precedence, because a customer can be more than one at once.** Most-work-first:
NEW → OLD-REBUILD → MEMBER PORTAL / REQUEST. Somebody who moved *and* picked new
colours is an OLD-REBUILD — reading it as a colour change would send the
warehouse to make one bundle for a house that needs the lot.

**A fifth badge she did not ask for: CHANGED.** Every colour change made before
today carries no source, because nothing recorded one. Those say CHANGED rather
than being assigned one of her four on a coin toss — a wrong provenance printed
beside somebody's name is worse than an honest "we do not know", and it fills
itself in from here on.

**Gate:** `build-reason.test.js` (`npm run test:reason`), its own file per R-018.
It RUNS the real rule over eleven cases and checks every field it reads has a
writer. 13 sabotages red-checked.

### Q-017 · does the badge belong on the printed build sheets too? · ANSWERED (see below)

She asked for it *"on warehouse"*, which is the tab, and that is what was built.
The two printed build sheets (`WH_BUILD_COLUMNS` and `PRINT_COLUMNS.build`) are
what the warehouse actually works from, and they do not carry it.

Not done unilaterally because a printed sheet is a fixed width of paper — the
whole reason `sheetOrder` exists — and the `Type` column already answers a
neighbouring question (House / ADD-ON / Blocked). Adding a column or overloading
Type are different decisions with different costs, and both are hers.

### Q-018 · should the Warehouse tab's build queue match the Printing tab's? · ANSWERED (see below)

Still open from earlier today. `whBuildQueueGroups` (the tab) lists
`needsLightBuild` only; `printNeedsBuildList` (the Printing tab) lists
`needsLightBuild || chargeNewMemberFee === true || requoteAppliedAt`. So the
screen and the paper can disagree about who needs building — which is the exact
shape of failure this repo has been bitten by repeatedly.

---

## Answered 2026-08-24 — Q-017 and Q-018, both closed

**Q-017 (does the badge belong on paper?) — yes.** Addie: *"I need paper to carry
badge too."* It is a **Why** column on the build sheet, beside Type.
`whBuildReasonLabel` renders it in words, sharing `whBuildReasonKey` with the
on-screen chip — one rule, two renderers.

**Q-018 (should the two build lists match?) — yes, and the tab wins.** Addie:
*"everyone on the warehouse tab should be printed."* The Printing tab now takes
its rows from `whSheetRowsForBuild`, so there is one build sheet printed from two
buttons.

The old disagreement ran in **both** directions and the second one was the
expensive half: `chargeNewMemberFee` and `requoteAppliedAt` are stamps that
nothing ever clears, so every new member and every applied re-quote sat on the
printed Needs Building sheet permanently, long after their bundle was made.

**And the split:** one page per colour group, offered against one page per badge.
A colour-and-wire group is the pile somebody physically pulls from, so two people
can build at once; splitting by badge cuts across the piles and sends each person
to every shelf.

### Answered — why a house can be "waiting on light colours" at all

Addie, seeing that block for the first time: *"Why is a house waiting on light
colors here? That is required and someone should not be able to submit a form
without it?"*

She is right about the doors a person types into, and both enforce it:

- the customer's detail form refuses to submit (`blockingAnswers`, index.html)
- Add Customer refuses to save — *"Pick their light colours before adding
  them — a customer with no colours never reaches the Warehouse to be built."*

**The producer is the master-sheet sync.** `admin.html` sets `needsLightBuild:
true` on every customer it adds and takes colours from the sheet's Lights
column, so a blank or unreadable cell there creates somebody owed a build with no
colours on file. The other sources are records already in the book from before
those guards existed, and a re-quote applied to a customer who had none.

⚠ **Do not "fix" it by dropping the build flag when colours are missing.** Those
people would silently vanish instead of appearing on a list — which is the exact
failure the blocked block was built to end. Blank colours mean the build cannot
be *done* yet, not that it is not *owed*. The page leads the printed stack so it
reads as a to-do list rather than a mystery.

### Q-019 · should the sheet sync refuse a row with no colours? · WITHDRAWN — the sync was never the problem (see below)

The narrower version of the above, and worth asking on its own. The sync
currently adds the customer and flags the build, which is right — but it could
also *report* how many it added with no colours, the way it already reports rows
it could not match. That would put the number in front of the office at the
moment it is created rather than the next time somebody prints.

---

## Answered 2026-08-24 — most of the "waiting on light colours" block was a read bug

Addie: *"All I want are the lights saved on peoples houses that don't have a
category of lights its under like red, warm."*

She was right to be suspicious of that block, and the cause was not a missing
answer — it was **an answer nobody was reading**.

`rbDetectColorsAndPattern`, which the master-sheet sync writes through, only
fills `lightsDescription` when a colour **repeats**, because a repeat means an
alternating pattern where the order matters and a sorted list would destroy it.
An ordinary house comes back as `{colors: ['Red','Warm White'], pattern: ''}` —
confirmed by running the real splitter, not by reading it.

Four warehouse readers tested the description alone, so **every ordinary house
the sync added** was:

- called blocked — "NO LIGHT COLOURS ON FILE", with its colours on the record
- given **no bulbs in the colour totals** — the costly one, since those totals
  are what gets ordered
- left out of the pending house count
- filed under "No lights recorded" on the recycle queue

`houseLightsText(d)` is the one answer now and all five callers ask it,
`printLightColor` included — so the printed cell and the group heading above it
can no longer describe one house two ways.

This closes Q-019 as well: the sync was never the problem. It was writing the
colours correctly all along.

**What is still genuinely blocked** is the small real case — a house with
nothing in either field. That page still leads the printed stack.

---

## Answered 2026-08-24 — the colour audit

Addie: *"Soft is Warm White and Warm is Warm white. Is there any other colors
having problems besides that"*

**`warm` was already right** — it has mapped to Warm White the whole time.

**The bigger problem was that there were two colour systems that knew different
words.** The master-sheet import understood `ww`, `w`, `warm`, `pure`, `p`, `pw`,
`r`, `rr`. The warehouse grouping understood only the nine full names. So any
record whose description held an abbreviation became its own heading — `ww` and
`Warm White` sat in two piles for one build. One shared vocabulary now.

**Also fixed:** normalising was not idempotent. `soft(recycled)` — the value the
import itself writes — came back as `soft(recycled) (recycled)`, because the
reader that pulls a trailing `(note)` off a description tore its brackets apart.

**Added** (each can only mean one colour): `bbb` — the table already had `rrr`
and `ggg`, so it was disagreeing with itself; the hyphenated and British spellings
of multi-colour; and the plurals.

**Not added, deliberately** — every one of these is a guess, and a wrong colour is
a bundle nobody can use: `pur` (Purple or Pure?), `pu`, `or` (an English word —
"red or green" would break), `orng`, `pnk`, `blu`, `grn`, `mc`, `rainbow`,
`clear`, `cool white`, `bright white`.

⚠ An unrecognised word is **not** silently mis-assigned. The description is kept
exactly as typed and appears as its own group heading, which somebody can see and
correct. That is the design and it beats guessing.

### Q-020 · should `soft` fold into Warm White? · ANSWERED — yes (see below)

**This is the one thing not changed, because changing it would reverse her own
earlier instruction without her seeing the cost.**

On 2026-08-19 she said: *"soft is a color we dont use anymore so we should have
them under color: soft(recycled) so then we can find them later cause we need to
switch their lights"*. That separate label is the only thing making those houses
findable — there is no other flag for them.

On 2026-08-24 she said: *"Soft is Warm White"*. Physically true.

The trade:

- **Keep `soft(recycled)`** — the twelve houses stay findable and switchable, but
  they sit in a build group the warehouse cannot make, because `soft(recycled)`
  is not a colour anybody stocks.
- **Fold into Warm White** — they build correctly and immediately, and the list
  of who still has old stock is gone for good.
- **Both** — group and build them as Warm White, and add a separate field marking
  the old stock so the list survives. More work, loses nothing.

---

## Answered 2026-08-24 — the colour rulings

Addie went through the list and ruled on every one. All applied.

**The one that changed behaviour, not just coverage:** a repeated single letter is a
*count*. *"R is Red, RR is Red, Red"*, *"bbb is Blue, Blue, Blue rrr is Red, Red,
Red, ggg is Green, Green, Green"*. They used to collapse to one colour, so `rr` and
`rrr` were the same build. They are different strands now.

That fits what the code already believed: `pure/pure` has always been two pures, and
a repeat is what marks a description as an alternating pattern. `rr` is the same
idea in a shorter notation.

⚠ **WW and PW are initials, not repeats** — she gave both in the same message.

**A consequence worth knowing:** the group heading used to sort colours
alphabetically, so `rrgg` and `rgrg` — the same four bulbs, two different strands —
would have become one heading. A plain set still sorts (so two people typing the
same two colours land together); a list with a repeat in it now keeps its order.

**Her rulings:** `pur` → Pure White (not Purple — that is the one I would have got
wrong), `clear` / `cool white` / `bright white` → Pure White, `orng` → Orange,
`pnk` → Pink, `blu` → Blue, `grn` → Green, `rainbow` → Multi, plurals → the
singular colour, and anything multi-something → Multi.

### Q-021 · what does `mc` mean? · ANSWERED — skipped for good (see below)

Addie: *"mc lets come back to this one."* Left unmapped deliberately — it falls
through to its own heading, which is visible and correctable, rather than being
guessed at. A check holds it there so nobody expands it plausibly later.

### Q-022 · are the letters ever run together, like `rrgg` in one cell? · ANSWERED — yes (see below)

`rr` and `gg` are read correctly on their own, and `rr/gg` or `rr,gg` works. A
single cell reading `rrgg` with no separator is **not** understood — it would need
letter-run parsing, which is a guess about where one colour ends and the next
begins, and `rrgg` is equally plausible as a typo. Worth one look at the real
Lights column; if that spelling appears, it is a small change to make.

---

## Answered 2026-08-24 — Q-022, letters run together

Addie: *"That is still Red, Red, Green, Green all of those ways."*

So `rrgg`, `rr/gg` and `rr, gg` are one thing — the separator is optional. `rbLetterRun`
reads the letters one at a time and both normalisers ask it.

⚠ **Only `r`, `g`, `b` and `o`**, and that limit is the whole safety of the rule.
`w` and `p` are excluded because **WW and PW are initials, not repeats** — she ruled on
both in the same message as the counts. A reader that expanded every letter would turn
`ww` into two warm whites, which is the opposite of what she said. And `wwrr` is
genuinely ambiguous — Warm White then two reds, or two warm whites then two reds — so
it is left exactly as typed, visible and correctable.

The alias table and the run reader agree on every token both can read, and that is
asserted rather than arranged: a clashing alias fails the build instead of being
silently resolved.

### Q-023 · what is `C`? · ANSWERED, it was a typo

Her message ended with a bare `C`. Asked: *"Oh I accidently typed a c"*. Nothing to
map, nothing was added, and no code changed. Recorded rather than deleted so nobody
reads the earlier message and goes looking for a rule that never existed.

---

## Answered 2026-08-24 — Q-020 (soft) and Q-021 (mc), both closed

Addie: *"just skip mc and soft should be Warm White"*.

### Q-021 — `mc` is skipped for good

It stays unmapped and falls through to its own heading, which is visible and
correctable. A check holds it there so nobody expands it plausibly later.

### Q-020 — soft is Warm White

This **reverses her own ruling of 2026-08-19**, and she was told the cost before
deciding. `soft`, `soft white` and the stored `soft(recycled)` all map to Warm
White, so those houses build with the plain warm white ones instead of sitting in
a group headed `soft(recycled)` — not a colour anybody stocks, and so a group
nobody could build.

**The switching list survives**, which is what made the trade cheap and is worth
knowing before anybody "tidies" it. The All Customers filter matches `/soft/i`
against the **raw** record and never goes through the colour table, so every house
already carrying `soft(recycled)` is still findable, and the two colour checkboxes
that write it are untouched. Both are held in place by checks.

⚠ **The one real loss:** a master-sheet sync that rewrites one of those rows will
replace `soft(recycled)` with `Warm White` on the record, and that house then drops
off the switching list permanently. If the twelve houses matter, run the filter and
write the list down somewhere outside the system before the next sync.
