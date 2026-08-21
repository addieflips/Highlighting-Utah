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

### R-005 · read
**A disputed confirmation blocks the crew sheet from being treated as final.**
Non-response is not confirmation, but it does not block — the customer isn't
obligated to reply.

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

### R-009 · code
**`main` cannot merge a failing build.**
*Enforced by:* branch protection requiring the test workflow.
*Why:* the site publishes from `main` regardless of test state. This is the only
thing standing between a red commit and production.

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

### R-015 · code
**Money is computed in exactly two places, and they are parity-tested.**
`js/money.js` and `functions/index.js`. A third implementation — a PayPal button
amount, a quote render, an invoice display doing its own arithmetic — requires
explicit approval and extends the parity test.
*Why:* parity between two is only complete if there are exactly two.

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

*(empty — Claude appends here using the format in `CLAUDE.md` §5)*

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
