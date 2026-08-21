# Rules

Numbered, stable, amendable. `CLAUDE.md` holds the protocol for following,
contradicting, and proposing these. Read that first.

**Tier** is the precedence tier from `CLAUDE.md` §2. **Enforcement** is `code`
(a test fails), `hook` (checked on stop), or `read` (must be read and honored —
drifts, and gets promoted after two violations).

---

## Customer correctness — tier 1

### R-001 · code
**Every customer-facing option lives in `js/options.js` and nowhere else.**
An option hand-written into a view is a bug, even if it renders correctly today.
*Why:* five artifacts render options. Hand-writing means remembering five places,
and forgetting produces no error — the truck just arrives without the timer.
*Enforced by:* `audit()` in `js/options.js`, blocking in CI.

### R-002 · code
**An option with no value renders `none`, never a blank or omitted line.**
*Why:* missing data and "they didn't want it" are indistinguishable when the
answer is silence. A crew member can verify twelve printed answers at a glance;
they cannot verify an absence.
*Enforced by:* crew sheet renderer test.

### R-003 · read
**A customer-facing option must reach all six destinations:** quote form,
customer record, pull list, crew sheet, invoice line, confirmation text.
Declare them in `consumers` and let the renderers generate.
*Exception:* internal-only options (e.g. bins) may omit `quote`, `confirmation`
and `invoice`, but must declare that deliberately.

### R-004 · code
**Anything the customer pays for must appear on the confirmation text.**
*Why:* they cannot dispute a charge they were never shown.
*Enforced by:* `audit()` — `affectsPrice` without `confirmation` in `consumers` fails.

### R-005 · ~~read~~ · **RETIRED 2026-08-21** (see amendment log)
~~**A disputed confirmation blocks the crew sheet from being treated as final.**~~
~~Non-response is not confirmation, but it does not block — the customer isn't~~
~~obligated to reply.~~

**Retired because the state it governs does not exist and is not being built.**
The confirmation is the RSVP email, which accepts exactly three answers —
`yes`, `no`, `backnextyear` — and `portalRsvp` rejects anything else outright.
There is no "disputed", so this rule described a condition nothing could ever
produce while reading as active protection.

The half worth keeping is already true without a rule: a customer who answers
`no` or `backnextyear` is pulled off upcoming routes by the portal, and
`isOutForSeason` keeps them off. Non-response is `unanswered`, which is visible
and does not block — as this rule said, and as the code already does.

⚠ Do not re-propose a catch-all "something is wrong" reply. It was considered
and rejected on 2026-08-21: an answer that sometimes means *don't come* and
sometimes means *my colours are wrong* is how a crew skips a house that was
fine. A customer with a problem calls the office, and a customer with a wrong
detail fixes it in the portal — which is what the portal is for.

---

## Irreversibility — tier 2

### R-006 · read
**No bulk or destructive operation runs without a preview and an explicit confirmation.**
Applies to Start New Season, nightly billing, payment ledger adjustments, and any
future operation that writes more than a handful of records.
The preview states counts: *"archives 340 customers, creates 340 invoices, clears 12 routes."*

### R-007 · code
**Destructive operations cap their own blast radius.**
Refuse to run if the change count exceeds a sane multiple of the prior run, and
require an explicit override.

### R-008 · read
**What a destructive operation actually did gets logged, in a form that can be
diffed against what it said it would do.**

### R-009 · code — **ENFORCED, verified 2026-08-21**
**`main` cannot merge a failing build.**
*Enforced by:* branch protection on `main` requiring the `Tests` workflow —
`Fast suite (no browser)` and `Browser tests (Playwright)`.
*Why:* the site publishes from `main` regardless of test state. This is the only
thing standing between a red commit and production.

⚠ This rule shipped on 2026-08-21 as a **statement of fact that was false** —
`main` was unprotected and nothing enforced it. Addie turned protection on the
same day and the API now reports `main` as `protected: true`.
*Scope of that check:* it confirms protection EXISTS, not which rules it carries.
If this ever needs to be relied on absolutely, confirm by opening a PR with a
deliberately failing check and watching the merge button refuse.

---

## Data integrity — tier 3

### R-010 · hook
**Every field has a writer, a reader, and a declaration.**
Written-and-never-read is a dead end. Read-and-never-written is a blank field.
Either one is a bug.

### R-011 · code
**Every derived artifact carries a source stamp** — the version of the record it
was generated from — and flags itself stale when that record changes.
Applies to crew sheets, pull lists, invoices, confirmations.

### R-012 · read
**Holes surface on the record, not only in a panel.**
The person looking at that customer is the one who can fix it.

### R-013 · read
**New findings are distinguished from baselined backlog.**
A badge that reads "47 issues" forever gets ignored, which is worse than no badge.

---

## Consistency — tier 4

### R-014 · code
**Business constants exist in exactly one file.**
Bins, bundles, footage rates, price tiers. Tests import the same file production does.
*Why:* duplicated constants are the number one cause of tests that contradict
production — one missed edit and a test calls production wrong when it isn't.

### R-015 · code — TARGET, NOT YET TRUE (see amendment log)
The amount owed is computed by `balanceDueAmount()` and nowhere else.
Every display, charge and link — admin, portal, PayPal, Venmo — calls it.
Parity tests cover the amount, not only the status string and invoice key.

Status 2026-08-21: ~12 hand-inlined implementations exist.
balanceDueAmount() has 12 callers, all inside admin.html; functions/index.js
and index.html have no equivalent at all, so the PayPal charge and the
customer's own portal each compute the amount their own way.
Phase 0a step 1 landed — money-parity.test.js now runs all 12 sites against
balanceDueAmount() and they agree. Step 2, the consolidation, has not.
Until it lands, do not rely on this rule when reviewing a change.

### R-016 · read
**Generation beats verification.**
If generating an artifact removes the possibility of a bug class, generate it —
do not hand-write it and add a test.

### R-017 · read
**Assert on meaning, never on DOM paths, pixel positions, or source strings.**
The selector contract already owns id-existence. Everything else asserts behavior.

### R-018 · read
**Do not add checks to `run-all.js`.**
It is large enough that additions lower signal. New tests go in browser specs,
parity tests, or fixtures.

### R-019 · read
**Suite findings are tiered: block / warn / note.**
Business rules, math, data flow, contracts and the option audit block.
Source-shape assertions warn. Cosmetic drift notes.
Every `warn` gets an owner and an expiry date, or it becomes wallpaper.

---

## Process — tier 5

### R-020 · read
**Never guess. Unresolvable questions go to `docs/open-questions.md`.**
An unanswered `intent` question on a customer-facing data path blocks the change.

### R-021 · read
**Questions are batched into one list at the end of a change**, and each cites
the rule, map, or registry entry it came from.

### R-022 · read
**Do not automate a low-blast-radius cosmetic test.** Archive it.
Screenshot baselines cover that ground, and each automated test is maintenance forever.

---

## Proposed

Not active. Do not follow until moved into the numbered set above.

### P-003 · proposed 2026-08-21
Rule: Anything the crew portal shows on a stop must also print on the crew sheet.
      The paper is the fallback when the phone has no signal, so the two must
      carry the same facts.
Why: Addie, 2026-08-21 — "Everything saved in crew should also print on the
      schedule sheet we print off." Deriving the option registry found three
      fields that reach one crew surface and not the other: the gate code and the
      which-outlet install notes show in the portal and never print, so a crew
      working off the printed sheet arrives at a gated house with no code.
Would have caught: exactly those three. Every field involved is correctly
      written, stored and read, so no existing check could see it — the hole is
      BETWEEN two artifacts, which is R-003's territory.
Might wrongly block: the sheet is a fixed-width piece of paper and the portal is
      not. A long free-text field that is fine on a phone can wreck a printed
      column, so this rule forces a layout decision every time the portal gains a
      field. That cost is the point — the alternative is finding out at a gate.
      ⚠ It does NOT run the other way: `useEaves` prints and is absent from the
      portal, and this rule would not catch it. If both directions are wanted,
      say so and it becomes "the two crew surfaces carry the same fields."
Enforcement: code
Tier: 1 — a crew that cannot get in does not install the lights.

### P-002 · proposed 2026-08-21 · revised 2026-08-21 after Q-008 / Q-009
Rule: Every health-check finding is DELIVERED as a System notice carrying its own
      preview, and is approved or denied there rather than sitting in a panel.
      Approve means the finding is real — and where the check has an auto-fix,
      approving RUNS it. Deny means this one is fine: it records an exception
      PER MEMBER, scoped to a fingerprint of the finding, so it lapses on its own
      when that member's data changes. The decision is stored per
      check+member+fingerprint, never on the notice.
Why: the panel has no way to express an exception at all today — the only ones
      that exist are hard-coded category rules inside hcSharedPhoneGroups — so a
      standing finding either nags forever or gets scrolled past, which is
      R-013's failure exactly. And six fixes currently run from an unguarded
      button press with no preview and no record of what they wrote.
Would have caught: nothing yet — new capability, not a past incident. Modelled on
      the "Light Color Change" System notice, which already carries a Send to
      Warehouse button and records addedToWarehouseAt when actioned.
Might wrongly block: approving now WRITES, so a notice covering many members is a
      bulk operation from one click. That is why the preview is part of the rule
      and not a nicety — R-006, R-007 and R-008 all attach to the notice. Storing
      the decision on the message document would be the cheap implementation and
      is unbuildable: `messages` refuses any create over 5,000 characters, so a
      check with fifty rows could never offer per-member denial.
Enforcement: code
Tier: 2 — it writes, and R-006 governs anything that writes in bulk.
       (Proposed at tier 3; raised on Q-009's answer, which turned the notice
       from a report into a write path.)

### P-001 · proposed 2026-08-21
Rule: A rule that asserts a safety property must be verified against the code
      when written, and marked TARGET if the property does not yet hold.
Why: R-015 claimed money parity covered the amount. It never did.
Would have caught: R-015 and R-009 shipping as false statements of fact.
Might wrongly block: adds a verification step to every new rule.
Enforcement: read
Tier: 3

---

## Rejected

Kept so they don't get re-proposed.

*(empty)*

---

## Amendment log

Every change to this file gets a line. Never silently edit a rule.

| Date | Change | Reason |
|---|---|---|
| 2026-08-21 | Created R-001 – R-022 | Initial rulebook, seeded from the data-integrity plan |
| 2026-08-21 | Replaced R-015, and marked it TARGET | The rule asserted a guard that does not exist. It claimed money is computed in exactly two parity-tested places; `money-parity.test.js` compares only the invoice STATUS string and the invoice KEY, never the AMOUNT OWED. The amount is hand-inlined at ~12 sites across `admin.html`, `functions/index.js` and `index.html` — including the PayPal charge and the member portal. Reviewing a change against the old wording would have passed a fourth implementation as safe. See `docs/open-questions.md` Q-001. |
| 2026-08-21 | Corrected R-015's own Status paragraph | The rule shipped hours earlier carrying the same "zero callers" error as the amendment below it. Left standing it would be a false fact inside a rule people read to decide things — which is what P-001, proposed the same day, exists to stop. The wording is otherwise Addie's, unchanged; only the factual clause moved. |
| 2026-08-21 | Corrected the R-015 amendment above | It first said `balanceDueAmount()` "has zero callers". It has 12, all in `admin.html`. The error was a malformed grep that was not re-checked before being written down — which is exactly what P-001 exists to prevent, on the same day P-001 was proposed. The rule change itself stands: the helper is used properly in admin, and the defect is that `functions/index.js` and `index.html` have no equivalent at all. |
| 2026-08-21 | R-009 marked ENFORCED | It shipped as a statement of fact that was false: it claimed branch protection was requiring the test workflow, and `main` was unprotected. Addie enabled protection on 2026-08-21 and `main` now reports `protected: true`. Noted in the rule what the check does and does not prove — that protection exists, not which rules it carries. Third rule this session found asserting a guard that did not exist (R-005, R-009, R-015), which is what P-001 was proposed for. |
| 2026-08-21 | RETIRED R-005 | It required a `disputed` confirmation state that does not exist and is not being built. The confirmation turned out to be the RSVP email (Addie, 2026-08-21), which accepts only `yes`, `no` and `backnextyear` — `portalRsvp` rejects anything else. So R-005 was tier-1 protection against a condition the system cannot produce, which is worse than no rule: it reads as cover while providing none. The behaviour that mattered is already implemented without it — an answered `no` pulls them off upcoming routes and `isOutForSeason` keeps them off. Marked retired in place rather than deleted, so the numbering holds and the history stays readable. A catch-all "something is wrong" reply was considered and rejected in the same conversation. |
| 2026-08-21 | Proposed P-003 | Addie, deriving the option registry: "Everything saved in crew should also print on the schedule sheet we print off." Three fields reach the crew portal and never print — the gate code and the which-outlet install notes among them. Tier 1, because a crew that cannot get through the gate does not install the lights. Noted in the proposal that it is one-directional and would not catch `useEaves`, which prints and is missing from the portal. |
| 2026-08-21 | Revised P-002, and raised it from tier 3 to tier 2 | Q-008 and Q-009 answered. Two changes. Denial is PER MEMBER, so the decision cannot live on the notice — `messages` caps at 5,000 characters and a check with fifty rows could never offer per-member choice; it is keyed on check+member+fingerprint instead. And approving now RUNS the auto-fix, which turns a notice into a bulk write path: one click on "43 invoices have drifted" is 43 money writes, so R-006's preview, R-007's blast-radius cap and R-008's log all attach, and the rule moves to the irreversibility tier where those live. |
| 2026-08-21 | Proposed P-002 | Design agreed in conversation: health-check findings that need a judgement call should arrive in the System inbox to be approved or denied, rather than accumulating in a panel with no way to express an exception. Two intent questions have to be answered before it can be built — what Deny means over time (Q-008) and which checks may notify at all (Q-009). |
| 2026-08-21 | Proposed P-001 | R-015 and R-009 both shipped as statements of fact about guards that were never in place. A rule asserting a safety property should be checked against the code when written, and marked TARGET when the property is still aspirational. |
