# Implementation Plan — Data Integrity & Connection Verification

**For:** the admin system (Firebase + Netlify + Cloud Functions, PayPal, Twilio)
**Goal:** nothing a customer asks for falls through between the quote and the install.
**Audience:** the coding agent implementing this. Read section 0 before touching anything.

---

## 0. Rules of engagement

Read these first. They matter more than the individual tasks.

1. **Read the repo before you build.** This plan was written from a description of the system, not from the code. Section 1 is my understanding; verify it. Where reality differs, say so before you start rather than building on a wrong assumption.

2. **Answer section 9's open questions first.** Four of them change the plan depending on the answer. Resolve what you can by reading code. Anything you can't resolve goes in `docs/open-questions.md` (section 8.3) — **do not guess.** Guessing is the exact failure mode this whole plan exists to prevent.

3. **Work in phases, in order.** Each phase is independently shippable and each one leaves the system better than it found it. Do not start phase N+1 with phase N half-done.

4. **Don't break what works.** The existing suite (3,467 checks), money parity, the health check panel, and the syntax/selector gates are all load-bearing. This plan extends them; it does not replace them.

5. **When a phase is done, run the existing fast suite and report the result** before moving on.

---

## 1. System context — what already exists

Verify this against the repo. Correct it where I'm wrong.

### Automated tests (GitHub Actions → `.github/workflows/tests.yml`)

| File | Guards |
|---|---|
| `verify-syntax.js` | Every inline `<script>` parses; `<div>` opens = closes |
| `selector-contract.test.js` | Every `#id` a browser spec targets still exists in the HTML |
| `money-parity.test.js` | `js/money.js` vs `functions/index.js` invoice math on identical inputs |
| `run-all.js` | ~3,467 checks across ~60 sections |
| `test/portal.spec.js`, `test/quote-link.spec.js` | 13 Playwright specs, Firebase faked |

### Live self-checks

- **Health Check panel** in `admin.html` — 19 data-integrity checks against real data, auto-runs 6s after login and every 10 minutes, badges the sidebar.
- **Stale-run banner** — red if billing hasn't run in ~36 hours.
- **Nightly summary** via Twilio.

### Manual checklist

- `js/test-seed.js` — 110 written manual tests across 16 areas. Status: 17 pass, 3 N/A, 2 retest, **88 not run.**

### Known gating behavior

- The fast suite **blocks the Cloud Functions deploy.**
- **Nothing gates Netlify** — the site publishes from `main` regardless. Netlify instant rollback is the only safety net.

### Known non-blocking gaps

- Three data-flow gaps around the quote-prefill form, reported but not blocking.

---

## 2. Guardrails — do not do these

These are deliberate exclusions. If you think one is wrong, raise it rather than acting on it.

- **Do not add checks to `run-all.js`.** It is already large enough that additions lower signal. New tests go in browser specs, parity tests, or the new fixtures.
- **Do not convert all 110 manual tests.** Most Crew Portal and Admin cosmetic checks should be *deleted*, not automated — low blast radius, immediately noticed when broken, and each one automated is maintenance forever. Screenshot baselines (phase 7) cover that ground.
- **Do not assert on DOM paths, pixel positions, or exact source strings** in new tests. Assert on meaning. The selector contract already owns id-existence.
- **Do not tighten the structural section checks in `run-all.js`.** If anything, demote them to warn tier (section 7.4).
- **Do not add a fourth place that computes money.** See open question 9.1.
- **Do not write a test where a generated artifact would remove the possibility of the bug.** Generation beats verification throughout this plan.

---

## 3. Phase 1 — The option registry and generated artifacts

**This is the core of the plan. Everything else is support.**

### 3.1 Goal

One file lists every option a customer can ask for. Five artifacts generate from it and nothing else. Adding a new option makes it appear in all five automatically, so *forgetting to display it* stops being possible rather than being something we test for.

### 3.2 The file

`js/options.js` — already added to the repo, with the real option set filled in.

Each entry declares:

- `id`, `label`, `type` (`measure` / `choice` / `count` / `text`), `unit`, `choices`, `default`, `required`
- `consumers` — which of the five artifacts **must** render it: `quote`, `confirmation`, `crewSheet`, `pullList`, `invoice`
- `warehouse(value)` — what physical stock it implies, for the pull list
- `affectsPrice` — whether `js/money.js` consumes it
- `crewNote` — extra instruction printed on the sheet

### 3.3 Wire the five consumers

Replace hand-written field rendering with generation in each:

1. **Quote form** — fields render from `OPTIONS.filter(o => o.consumers.includes('quote'))`, in registry order.
2. **Confirmation text** — `confirmationText(customer)`.
3. **Crew sheet** — `crewSheet(customer)`.
4. **Warehouse pull list** — `pullList(customer)`.
5. **Invoice lines** — options with `affectsPrice`, priced through the existing `js/money.js` path. **Do not add new pricing arithmetic here** — call the existing code.

### 3.4 Never render blank

An option with no value renders **`none`**, never an omitted line.

Missing data and "they didn't want it" are indistinguishable when the answer is silence. If every option always prints, a crew member can verify the whole sheet at a glance. This is a small change with disproportionate payoff — do not skip it as cosmetic.

### 3.5 Wire the audit into CI

`audit()` in `js/options.js` catches:

- an option consumed by nothing (dead end)
- an unknown consumer name
- priced but never on an invoice
- customer pays for it but is never shown it
- needs warehouse stock but never on the pull list
- on the truck but not on the crew sheet
- a `default` that isn't one of its own `choices`

Add it to `.github/workflows/tests.yml` as a **blocking** gate. This is a real invariant, not a structural check.

Also wire `missingAnswers(customer)` into the quote-save path so a required option can't be left undefined.

### 3.6 Done when

- [ ] All five artifacts render from `OPTIONS`; no hand-written option field remains in any of them.
- [ ] A new option added to `js/options.js` appears in all five with no other code change. **Verify this by actually adding a throwaway option and observing it, then removing it.**
- [ ] Every option with no value prints `none` on the crew sheet.
- [ ] `audit()` runs in CI and blocks on failure.
- [ ] `audit()` returns empty against the current registry.
- [ ] Existing fast suite still passes.

---

## 4. Phase 2 — Confirmation before install, acknowledgment after

### 4.1 Why this ranks this high

Every other mechanism in this plan proves the data agrees with itself. This is the only one that checks against **what the customer actually wanted**. It is the only thing that catches:

- a request taken on the phone and never entered
- a value entered against the wrong customer
- an option the software has no field for

No detector can find those, because there's no record to examine.

### 4.2 Pre-install confirmation

- Send `confirmationText(customer)` via the existing Twilio path, N days before the scheduled install date (see open question 9.5 for N).
- Record `confirmationSentAt`, `confirmationRespondedAt`, `confirmationStatus` (`pending` / `confirmed` / `disputed`) on the customer or job record.
- A `disputed` reply flags the job in admin and **suppresses the crew sheet as final** until resolved.
- Non-response is not confirmation. Track it, surface it, but don't block on it — the customer isn't obligated to reply.

### 4.3 Crew acknowledgment at completion

- On the crew portal, each option on the sheet gets a check-off.
- Anything unchecked at job completion is recorded as an unfulfilled promise with the job and crew attached.
- This produces the *installed* side of the data that phase 3's reconciliation needs. Without it, reconciliation can only compare ordered vs. scheduled.

### 4.4 Done when

- [ ] A test customer receives a confirmation containing every `confirmation`-consumer option, including `none` values.
- [ ] A `disputed` reply visibly flags the job in admin.
- [ ] Crew check-off writes per-option fulfillment.
- [ ] Confirmation status appears in the nightly Twilio summary as a count.

---

## 5. Phase 3 — Staleness stamps and nightly reconciliation

### 5.1 Staleness

The specific failure: quote finalized in May, customer calls in June to add a timer, the crew sheet was generated in May and nobody regenerated it.

- Every generated artifact (crew sheet, pull list, invoice, confirmation) stores `stamp(customer)` — `{ customerId, sourceVersion }` where `sourceVersion` is the customer record's `updatedAt`.
- `isStale(artifact, customer)` is checked wherever the artifact is displayed.
- Stale artifacts render a visible **"stale — needs regeneration"** flag on the artifact itself, on the job in admin, and in the health panel.
- Regenerating clears it.

**Note:** this only works if the customer record has a reliable `updatedAt` that changes on every write. Verify that; if it doesn't exist, adding it is part of this phase.

### 5.2 Nightly reconciliation

For each job, diff four columns:

| ordered | scheduled | pulled | installed |
|---|---|---|---|
| from the quote + current customer record | from the crew sheet | from the warehouse pull list | from crew check-off (phase 2.3) |

Any row where those disagree is a finding:

```
Customer 412 — ordered: timer (dusk to 11pm) | sheet: none | pull list: none
```

This is the money-parity pattern applied to fulfillment: it compares two records of the same fact rather than asserting an expected value, so it can't go stale.

- Runs nightly alongside billing.
- New findings go into the Twilio summary as a count plus the first few.
- Results surface in the health panel.

### 5.3 Done when

- [ ] Editing a customer flags their existing crew sheet stale.
- [ ] Regenerating clears the flag.
- [ ] Reconciliation runs nightly and reports disagreements across all four columns.
- [ ] A deliberately mismatched test job is caught.

---

## 6. Phase 4 — Gates and destructive-operation previews

### 6.1 Gate `main` (settings, not code)

- Branch protection on `main` requiring the test workflow to pass before merge.
- Netlify deploy previews on PRs.

Once `main` can't go red, "the site publishes from `main` regardless" stops being a risk. This is four minutes of work and closes the largest structural hole in the pipeline.

### 6.2 Start New Season preview

See open question 9.3. If Start New Season does not already show what it's about to do:

- Add a dry-run that produces the full change list before executing: *"archives 340 customers, creates 340 invoices, clears 12 routes, resets 89 map pins."*
- Require explicit confirmation of that list.
- Cap the blast radius — refuse to run if the change count exceeds a sane multiple of last season's, and require an override.
- Log what it actually did, for comparison against what it said it would do.

**This outranks every test in this document.** A test suite protects against bugs; a preview protects against an irreversible mistake made by a person.

### 6.3 Apply the same treatment to

- Nightly billing (dry-run mode, and a cap on invoice count per run)
- Payment ledger adjustments
- Anything else that writes in bulk

### 6.4 Done when

- [ ] `main` cannot merge a failing build.
- [ ] Deploy previews appear on PRs.
- [ ] Start New Season shows and requires confirmation of its change list.
- [ ] Its post-run log can be diffed against its pre-run preview.

---

## 7. Phase 5 — Scan, map, and the generated hole walker

### 7.1 The write/read scan

Across `admin.html`, the member portal, the crew portal, and `functions/index.js`:

- Collect every field **written**.
- Collect every field **read**.
- Diff.

Two outputs:

- **Written, never read** — a dead end. Someone is typing information into a void.
- **Read, never written** — the source of mysteriously blank fields.

Report both as a list. Expect the first run to be uncomfortable.

### 7.2 Derive the data map

Build `docs/data-map.md` (or `.json` — machine-readable is required) **from the scan output**, not from a blank page. Then have it reviewed and corrected rather than authored.

It declares, per collection:

- fields, and their types
- which fields are references to another collection
- which fields are required for a record to be considered complete
- which pipeline stage each state belongs to, and the expected next stage

`js/options.js` is the customer-facing slice of this and should be referenced by it, not duplicated into it.

### 7.3 The generated walker

One walker over the map produces four hole types:

| Type | Meaning | Existing example |
|---|---|---|
| **Dangling** | Points at a record that doesn't exist | route stop → deleted customer |
| **Orphan** | Nothing points at it and something should | house with no customer |
| **Incomplete** | State requires a companion record that's missing | customer with a price but no invoice |
| **Stalled** | Entered a stage and never left it | approved quote that never became a customer |

All 19 existing health checks collapse into these four. **Migrate them into the walker rather than running both** — two systems checking the same thing is how they start disagreeing.

Requirements:

- Runs headless (Node) as well as in the panel — see open question 9.2.
- **Baselines the existing backlog** so the panel can show *new since yesterday* separately. Without this the badge reads "47 issues" forever and everyone stops looking.
- Ages findings.
- Surfaces each hole **on the record itself**, not only in a central panel. The person looking at that customer is the one who can fix it.
- New holes go into the nightly Twilio summary.

### 7.4 Shape drift (cheap, do it while you're here)

Sample records per collection and build a field-presence histogram. Two signals fall out free:

- A field present in 98% of records and missing in 2% → those 2% are a hole nobody declared.
- A field that started appearing recently → new writes possibly not wired downstream yet.

This is the only technique here that finds holes with no spec at all.

### 7.5 Consolidate constants

If bins, bundles, footage rates, or price tiers appear in more than one of `js/money.js`, `functions/index.js`, `run-all.js` — collapse to one shared file that all of them, tests included, import.

Duplicated constants are the number one cause of tests that contradict production: one missed edit and a test calls production wrong when it isn't.

### 7.6 Demote structural checks

Introduce explicit tiers in the suite:

- **block** — business rules, math, data flow, the option audit, contracts
- **warn** — source-shape assertions, the three known quote-prefill gaps
- **note** — cosmetic drift

Every `warn` gets an owner and an expiry date, or it becomes permanent wallpaper.

### 7.7 Done when

- [ ] Scan output exists and has been reviewed.
- [ ] `docs/data-map.md` exists, is machine-readable, and is derived from the scan.
- [ ] The walker generates checks from the map and runs both headless and in the panel.
- [ ] All 19 original health checks are represented by the walker and the old implementations are removed.
- [ ] The panel distinguishes new findings from baselined backlog.
- [ ] Constants exist in exactly one place.
- [ ] Suite tiers are explicit and structural checks no longer block.

---

## 8. Phase 6 — Making the behavior standing

### 8.1 `CLAUDE.md` and `docs/RULES.md`

**Both files are already written and shipped with this plan.** Place them at the
repo root and in `docs/` respectively. Do not rewrite them — amend them through
the process they describe.

- **`CLAUDE.md`** — the operating protocol, read every session. Covers the
  three-part check on every change, precedence when rules collide, when to ask
  vs. when to read the code, the never-guess rule, how to propose new rules, and
  rule promotion.
- **`docs/RULES.md`** — 22 numbered domain rules (R-001 – R-022), each tagged
  with a precedence tier and an enforcement mechanism (`code` / `hook` / `read`),
  plus `Proposed`, `Rejected`, and an amendment log.

Three mechanics in there that need implementation support, not just reading:

1. **Same-tier contradictions stop the work.** `CLAUDE.md` §2 forbids picking a
   winner silently — the conflict is reported in a fixed format and the
   resolution becomes an amendment. Make sure nothing in the workflow encourages
   pushing past it.
2. **`read` rules violated twice get promoted** to `code` or `hook` enforcement
   (§6). When you promote one, the enforcement is real work — a test or a hook
   check — and belongs in whatever phase owns that area.
3. **Rules R-001, R-002, R-004, R-007, R-009, R-011, R-014, R-015, R-018, R-019
   are tagged `code`** and need actual enforcement built. Most land naturally in
   phases 1, 4, and 5; check each one has a real check behind it before calling
   a phase done, or downgrade the tag to `read` and say why.

### 8.2 A `hole-check` skill

`CLAUDE.md` says *when*; the skill says *how*. It holds the procedure: read the map and registry, diff against writes and reads in the changed files, classify anything missing into dangling / orphan / incomplete / stalled, report as one batch.

### 8.3 `docs/open-questions.md`

Because instructions drift and questions asked in a chat window evaporate.

```markdown
# Open questions

Format: one entry per question. Never delete — mark answered.
Every answered question becomes a map or registry entry, so it's never asked twice.

## Q-001 · intent · open · 2026-08-21
Should a timer be allowed on a customer with no roofline and no walkway?
Blocks: validation rules in `js/options.js`
Answer:
Resulting map change:
```

Rules:

- **intent** = only Addie can answer (business rules, policy, what should happen).
- **factual** = resolvable by reading code, so it should never reach her. Resolve it.
- Anything `open` that sits on a customer-facing data path escalates rather than aging quietly.
- Every answer produces a map or registry change. If it doesn't, the question was mis-scoped.

Seed it with section 9's questions.

### 8.4 A Stop hook

`CLAUDE.md` is followed reliably at the start of a session and less reliably deep into a long one. If the check must always happen, a Stop hook that runs the walker and surfaces new findings is what makes it structural instead of aspirational — same reasoning as the health check running on a timer rather than when someone remembers to click it.

### 8.5 Done when

- [ ] `CLAUDE.md` exists with the rules above.
- [ ] `hole-check` skill exists.
- [ ] `docs/open-questions.md` exists, seeded, with the intent/factual distinction.
- [ ] Stop hook runs the walker and reports new findings.

---

## 9. Phase 7 — The tests (about thirty, total)

Deliberately last, and deliberately small. Generation and detection do the heavy lifting; these cover what's left.

### 9.1 Screenshot baselines — 5 or 6 pages

Admin, member portal, crew portal, invoice, quote, crew sheet.

One visual diff catches the entire "unbalanced div killed every panel below it" class, plus layout breakage, missing sections, and CSS regressions — across the whole page at once. **This single mechanism replaces most of the 88 unrun manual checks.** If only one item from this phase gets done, do this one.

### 9.2 Health-check fixtures in CI — 19

Seed one known-broken record per check; assert each check catches it.

Right now, if a health check silently stops working, you get a green badge forever — worse than no badge. This tests the monitor. Once phase 5 lands, these become fixtures for the walker's generated checks instead.

### 9.3 Security rules against the real emulator — ~5

Not faked Firebase. The 13 existing browser specs pass with auth faked, which means a production deny shows up as a customer email rather than a red build.

Cover: can a crew member read another customer's data; can a member portal user write to admin collections; can an unauthenticated request reach anything.

### 9.4 Blast-radius specs — ~5

Start New Season and the payment ledger only. Partial payment, refund, adjustment, ledger balance after each.

### 9.5 Triage `js/test-seed.js`

Three piles:

- **Automatable and worth it** — blast-radius items. Convert to Playwright.
- **Visual only** — covered by 9.1. Mark as such, don't convert.
- **Dead** — Crew Portal and Admin cosmetics. **Archive them.** A test nobody has run in a year isn't a test, and each one automated is maintenance forever.

Update the file so its status reflects reality rather than a backlog of 88.

### 9.6 Done when

- [ ] Screenshot baselines run in CI and fail on visual regression.
- [ ] 19 fixtures pass and each provably catches its own broken record.
- [ ] Security rule tests run against the emulator.
- [ ] `js/test-seed.js` has no "not yet run" items — every one is automated, covered, or archived.

---

## 10. Open questions — resolve before phase 1

Seed these into `docs/open-questions.md`. The first four change the plan.

**Q-001 · factual — Is there a third place money is computed?**
Check the PayPal button amount, quote rendering, and any invoice total display. Money parity between `js/money.js` and `functions/index.js` is only complete if those are the *only* two implementations. A third one is invisible to the parity test.

**Q-002 · factual — Can the 19 health checks run headless?**
Or are they welded into the panel in `admin.html`? They need to run in CI and nightly. If they're welded in, extracting them is part of phase 5 and adds scope.

**Q-003 · factual — Does Start New Season have a preview?**
If not, section 6.2 becomes the highest priority item in this document.

**Q-004 · factual — How much of `run-all.js`'s 3,467 checks are source-shape assertions vs. real logic?**
Determines how much of section 7.6's demotion applies, and whether 3,467 represents meaningful coverage or mostly structural noise.

**Q-005 · intent — How many days before install should the confirmation text go out?**
Needs to be far enough ahead to fix problems, close enough that the customer hasn't forgotten. Addie's call.

**Q-006 · intent — What happens to a job whose confirmation comes back disputed?**
Block the crew sheet? Flag and proceed? Who gets notified?

---

## 11. Sequence summary

| # | Phase | Blocked by | Rough size |
|---|---|---|---|
| 1 | Option registry + five generated artifacts | — | Largest single piece |
| 2 | Confirmation + crew acknowledgment | 1 | Medium |
| 3 | Staleness stamps + reconciliation | 1, 2 | Medium |
| 4 | Gate `main` + destructive previews | — (do anytime) | Settings + small |
| 5 | Scan → map → hole walker | — | Large |
| 6 | `CLAUDE.md` + skill + hook + questions | 5 | Small |
| 7 | ~30 tests | 1, 5 | Medium |

Phase 4's branch protection can be done in the first hour regardless of everything else.

---

## 12. What this plan does not cover

Stated explicitly so nobody assumes otherwise.

Detection finds structural holes. It cannot find:

- **Never entered** — a request taken on the phone that nobody typed in. No record, no hole to find.
- **Connected but wrong** — written, read, and rendered, but showing the wrong value. Structurally perfect, factually wrong.
- **Not in the system at all** — an add-on sold that the software has no field for.

Every detector in this plan is blind to all three, permanently. **Only the confirmation text in phase 2 catches them**, because it's the one check against what the customer wanted rather than against our own data — and even then, only when the customer replies.

That's why phase 2 ranks where it does, and why "nothing falls through" is a set of overlapping nets rather than a single mechanism.
