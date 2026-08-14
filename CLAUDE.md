CLAUDE.md — Highlighting Utah operating manual for Claude Code
You are Claude Code working on the Highlighting Utah app (a Christmas-light business). This file is your standing brief. It loads automatically from the repo root. It was written after a full read-through and audit of main on 2026-08-07, updated 2026-08-08 after the P0-P3 work queue, and corrected 2026-08-13 (see §1 — the deploy instructions were wrong) — trust the code over this file where they disagree, and update this file when structure changes.
Owner: Addie (non-coder). Prefers plain-English explanations, full working files, and no surprises with money or customer data. When something is ambiguous or risky, do the safe reversible thing and leave a note; escalate only real blockers.
0. Rules of engagement (always)
Pull first. git pull origin main before touching anything. main is the source of truth. Netlify auto-deploys main.
Verify before you commit. Run the verification gates in §3. Never commit a file that fails them.
Never break money or delete customer data. Invoice math, prices, payments, customer numbers, and Firestore data are sacred. Changes here get extra verification and a written explanation.
Money/portal changes ship as ONE push. If a change spans the website and Cloud Functions (or Firestore rules), deploy them together (see §5). A half-deploy means the nightly automation, PayPal, or the customer portal disagree with what the office sees.
Don't rewrite or delete working features unless the task says so. Before assuming something is dead code, check every read/write site — a field that looks orphaned from one angle can be a live feature entered from another (see §9, frontPhotoUrl).
Small, explained commits. One logical change per commit, message in plain English.
Work on the branch for the area you are touching. There is a standing branch per part of the admin portal (created 2026-08-13), so parallel work — the owner's and her sister's included — doesn't pile onto one file:
  tab/customers   Add a Customer, All Customers, Bulk Updates, Danger Zone
  tab/quotes      Quote Requests: pricing, Send Email, convert, nudges, quote email settings
  tab/messages    Customer Messages: inbox, folders, System notices
  tab/routes      Routes and Schedule: generate, save, print, fix and removal routes, calendar
  tab/warehouse   Warehouse and Customer Numbers: build queue, recycle, bins, number pool
  tab/invoices    Invoices, Dashboard finance, Per Foot Pricing — anything touching money
  tab/automation  Automation and Automation Emails: nightly invoicing, templates, SMS, weather
  tab/employees   Responsibilities and Time Logs: staff, crews, timecards, payroll export
  tab/website     Public site content: Reviews, Gallery, Hero Images, FAQ, Site Settings
Bring the branch up to date from main first (git merge main), work, run the gates, then merge back to main and push. These branches are long-lived — don't delete them after merging. Anything that doesn't fit one of them, or spans several, goes straight to main or onto a one-off claude/... branch.
Keep the Project To-Do checklist truthful. Any change that alters what a checklist test (TEST_SEED in admin.html) describes — a renamed button, a moved feature, changed behavior — needs that test's wording fixed and its version number bumped in the same change, or it silently goes stale (see §2 and §7). When a change retires a UI term a test used to describe (a renamed button, a removed label), add it to RETIRED_CHECKLIST_TERMS in run-all.js in the same commit — that's what actually fails gate B if this rule gets skipped, not just this sentence.
Don't stop to ask unless you truly have to — see §5 for the short list of things that genuinely need the owner. Default to doing the work on a branch and reporting it.
1. Stack & deploy commands (your automation primitives)
Three static HTML files + Firebase backend + Netlify hosting. No build step for the HTML.
File	What it is
index.html	Public site + the customer Member Portal
admin.html	Office dashboard (~1.4MB; two inline scripts — a plain one and a <script type="module">, which is the app itself)
js/money.js	The invoice and bin rules, pulled out of admin.html so they can be unit-tested (computeInvoiceStatus, statusClass, enrollmentYearOf, custInvoiceKey, cnBinsForFeet, fmtMoney, CN_DOUBLE_BIN_FEET). Imported by admin.html's module script — native browser modules, still no build step. ⚠ functions/index.js keeps its own copy of the invoice maths for the nightly run: change a rule in one and change it in the other, in the same push.
employee.html	Crew/Warehouse Portal
functions/index.js	Cloud Functions (Firebase v2, Blaze). Node 22 runtime, firebase-functions 7.x, firebase-admin 13.x as of 2026-08-13. ⚠ Do NOT bump firebase-admin to 14 as a routine update: 14 removes the namespaced API (admin.firestore, admin.auth are undefined there) and this file uses it in ~30 places, including admin.firestore.FieldValue.increment on deposits and tips in the PayPal capture path. That migration to the modular API is its own job with its own testing. Keep engines.node in functions/package.json matching node-version in .github/workflows/deploy-functions.yml.
firestore.rules / firestore.indexes.json	DB security + indexes
run-all.js	Main test suite (see §3) — needs `npm install` once at repo root (installs jsdom; package.json/package-lock.json are committed). Run it with `npm test`, which also runs the two below.
money-parity.test.js	Proves the browser and server copies of the invoice maths still agree. See §9.2 — this is the one that stops the office and the nightly billing run disagreeing about a bill.
scripts/verify-syntax.js	Verification gate A (inline JS parses, <div> tags balance). `npm run verify`.
quote-card.test.js	⚠ currently broken — its extraction marker was renamed out of admin.html. Excluded from `npm test`. See §3 gate B.
system-map.md	Plain-English map of the whole app — regenerate per §6
Firebase project id: highlighting-utah (billing on).
Deploy — each surface is separate. Netlify does NOT deploy Firebase, and Firebase does NOT deploy the HTML.
bash
# HTML (index/admin/employee): commit + push → Netlify publishes in ~1 min
git add index.html admin.html employee.html && git commit -m "..." && git push origin main
# Cloud Functions:
firebase deploy --only functions
# Firestore security rules:
firebase deploy --only firestore:rules
# Firestore indexes:  (⚠ offers to DELETE console-made indexes not in the JSON — say NO unless the file is known complete)
firebase deploy --only firestore:indexes
⭐ FUNCTIONS DEPLOY THEMSELVES — DON'T RUN IT BY HAND (verified 2026-08-13). `.github/workflows/deploy-functions.yml` deploys Cloud Functions automatically on any push to main that touches functions/** or firebase.json, using the FIREBASE_SERVICE_ACCOUNT repo secret. So the correct way to ship a change spanning the website and the functions is ONE push to main: Netlify publishes the HTML and the workflow deploys the functions, both from the same commit. That is exactly the "ships as ONE push" rule in §0, and it happens for free. Running `firebase deploy --only functions` by hand at the same time races the workflow — don't, unless the workflow is failing.
Watch the run at github.com/addieflips/Highlighting-Utah/actions (it also prints which service account it deployed as, and that account's real IAM roles, which is what to read first on a permissions error). To confirm a deploy landed without opening a browser: `firebase functions:list --project highlighting-utah`.
The local `firebase` CLI IS installed and logged in (v15.26.0, highlightingutah@gmail.com, project highlighting-utah) — verified 2026-08-13. An earlier version of this file said it wasn't and that deploys had to go through Firebase MCP tools; that is out of date. Use the real CLI for read-only checks (functions:list, projects:list) freely. Reserve hand-deploys for when CI is broken.
firestore:rules and firestore:indexes are NOT covered by the workflow — those still need a hand-run of the commands above.
Prereqs a human sets up once: git push credentials for github.com/addieflips/Highlighting-Utah. functions/ needs `npm install` locally if you ever hand-deploy (it fails with "Cannot find module 'firebase-functions'" until node_modules exists); CI does this itself. If a deploy fails with an auth error, stop and tell the owner — do not try to work around it.
⚠ Hand-deploys on this Windows machine fail at the analysis step, 2026-08-13: `firebase deploy --only functions` dies with "User code failed to load. Cannot determine backend specification. Timeout after 10000" before uploading anything. The source is fine — this is a handshake bug between the CLI and this machine. Discovery boots functions/ on a local port and GETs /__/functions.yaml; run that by hand (cwd=functions, `FUNCTIONS_CONTROL_API=true PORT=8401 ./node_modules/.bin/firebase-functions <abs path to functions>`, then curl 127.0.0.1:8401/__/functions.yaml) and it answers 200 in under a second. Raising FUNCTIONS_DISCOVERY_TIMEOUT does NOT help — nothing is slow, the CLI just never connects. The fix that works: save that manifest as `functions/functions.yaml`, which the CLI reads instead of doing the port handshake at all. DELETE it straight after the deploy and never commit it — it is a frozen snapshot, and if left in place later function changes are silently not picked up. All of this is only needed when CI is broken; the workflow above has no such problem.
⚠ Verify what is actually on disk immediately BEFORE a hand-deploy, not just before writing the code. On 2026-08-13 a deploy shipped the old file because a parallel Claude session switched the checkout to another branch in between — the deploy reported "Successful update operation" for code that did not contain the fix. A shrinking/growing upload size in the deploy log is a useful corroborating signal.
⚠ Historic note, 2026-08-08: a Cloud Functions deploy via the Firebase MCP tool once ran 45+ minutes with no output and never resolved. The GitHub workflow above is the answer to that — it runs in a clean environment and either succeeds or fails visibly. If you are ever waiting on a hand-run deploy with zero progress for ~10 minutes, treat it as suspect and say so rather than waiting indefinitely.
After pushing admin.html, always check the browser console for Render failed: lines — that names any broken render immediately (renders are individually wrapped so one failure no longer kills the rest).
2. Architecture in one screen
Full plain-English map lives in system-map.md (regenerate it — see §6). Essentials:
jobAddresses is the customer record; almost everything hangs off it.
Lifecycle: public quote (quotes) → office prices it → customer approves → convert to customer (jobAddresses) → Measured Feet drives bin count / number series / warehouse bundles → warehouse builds (needsLightBuild) → route (scheduledRoutes, snapshot of stops) → crew installs → nightly invoice email (invoices) → PayPal/Venmo payment → RSVP "no" → recycle → customer number returns to availableCustomerNumbers.
Measured Feet is the highest-leverage field — one number drives four things (bins, number series, bundle count ceil(feet/40), auto-price). Double-check it. The bin-count cutoff in code is actually 260 ft (CN_DOUBLE_BIN_FEET), not 200 — some UI/doc text still says "200 ft rule."
The one correct money formula, everywhere: owed = (install + removal + changeFees) − credits − deposit, floored at 0. As of 2026-08-08 this is actually true everywhere in admin.html and functions/index.js — it wasn't before (see §4 history).
Two separate $30 fees: new-member fee (added once by the nightly function, flagged newMemberFeeApplied, folded into install) and the light-change fee (changeFees / changeFeeNotes, added by portalSave when a member changes colours late — tracked as its own field, removable independently).
Portals reach protected data only through Cloud Functions (portalLookup/portalSave/portalRsvp/portalInvoice/quoteRespond/publicQuoteLookup) which use Admin SDK and bypass rules. A field the client reads must be in that function's read whitelist or the customer never sees it.
Automatic: nightly invoices (sendNightlyInvoices, 7 PM Mountain, 0 19 * * *), portal colour change → warehouse queue, late colour change → $30 fee, RSVP "no" → recycle flag, customer edits → upcoming route resync, carryover credit.
Project To-Do checklist: TEST_SEED (a plain-English test list hardcoded near the end of admin.html) auto-syncs into the projectTests collection on every login — new tests get added, and any test whose version number moved on since it was last scored flips to Retest (its old score and notes are kept, not lost; same-version wording tweaks just reword in place for free). This only stays accurate if TEST_SEED itself is kept current — the sync can't detect that a button got renamed or a feature moved, it only ever pushes whatever is currently written there. Whenever a change affects what a test describes, update that test's steps/expected and bump its version in the same commit.
3. Verification gates (must pass before every commit)
Run these and paste results into the commit/PR description.
A. Inline-JS syntax + <div> balance (catches the two most common breakages):
bash
npm run verify
This runs scripts/verify-syntax.js. It parses every inline <script> in the three HTML files, parses functions/index.js, and checks that <div> opens equal </div> closes in each file. Exits non-zero on any failure, so it is safe to chain in CI.
It replaced a python3 heredoc that used to be pasted in here. Same checks, but it is Node-only (no python dependency on Windows or in CI) and it checks classic scripts and <script type="module"> blocks SEPARATELY. That separation matters: concatenating them forced the classic code to be parsed in strict mode, where a few legal-but-old constructs are syntax errors — that could report a failure that does not exist in a real browser.
An unbalanced <div> silently swallows every panel below it, which is why the count is printed even when it passes.
B. Test suite.
bash
npm test
That runs all three gates in order — verify (gate A), the money parity test, then run-all.js — and stops at the first failure.
⚠ CORRECTED 2026-08-14: the old instructions here told you to copy the suite into a tests/ subfolder via a shim (mkdir -p tests && cp run-all.js ...). That is no longer needed and has not been for some time — run-all.js resolves its own root by looking for admin.html next to itself, so `node run-all.js` works directly from the repo root. The shim still works, it is just pointless. Ignore any older note saying the suite is broken from the root; it is not.
Needs `npm install` once at repo root (jsdom — package.json and package-lock.json are committed). Without it, the quote-card rendering checks silently skip instead of running — don't mistake that for a pass.
GAP lines are known disconnects (non-blocking, self-heal to PASS when fixed). Real regressions show as FAIL. A change is only clean if it introduces no new FAIL and doesn't turn a PASS or a closed gap back into a GAP/FAIL.
Baseline on 2026-08-14: 232 passed, 0 failed, 3 notes, 2 known GAPs (colorComboKey; two customers sharing a phone share one invoice key). Plus 9 passed on gate A and 10 passed on the money parity test.
⚠ KNOWN BROKEN, not yet fixed: `quote-card.test.js` no longer runs. It extracts renderQuoteRows out of admin.html starting from a marker function `quoteDetailSelect(` that has since been renamed or removed, and renderQuoteRows has grown roughly four new helper dependencies (quoteStage, quotePhotoList, currentQuotePhotoIndex …) that the file does not stub. It is deliberately NOT part of `npm test` so the suite stays honest — fixing it is its own small task. Do not "fix" it by deleting it.
C. Element-ID sanity (a lesson learned the hard way): every element ID referenced in JS must exist in the HTML, there must be no duplicate IDs, and after any big HTML deletion re-check the <div> balance (gate A). This is folded into Suite 1 of gate B above. ?. optional chaining hides missing markup as a silent no-op — don't trust "no error" as "it works."
4. Work queue history (P0-P3, completed 2026-08-08)
The P0-P3 items from the 2026-08-07 audit are done and deployed (HTML side confirmed live via Netlify; the Cloud Functions half of P0 hit the deploy issue noted in §1 and needs the owner to confirm it actually landed — check the PayPal charge amount against a real discounted/fee'd invoice, or check the Firebase Console function source directly). Summary, for context on anything that references "the P0 fix" etc.:
P0 (money bug, changeFees not carried everywhere) — found to be much larger in scope than originally described: not 5 places but ~20+, including the PayPal charge total, the portal invoice read whitelist, the printable/emailable invoice document builder (buildInvoiceDocHtml — was missing the fee as a line item entirely), the email-recipient payment-status filter, the "All Customers" table filter, the Excel exports, and several bulk-tool status computations. All fixed; computeInvoiceStatus and the raw balance formula now consistently include changeFees everywhere they're computed.
P1 (quote-card UX) — Detail Form block removed from admin.html's quote cards (customers now fill it in on their own portal after approving, via a Firestore rules change already live — see §8). Pricing & Approval panel converted from native <details> (which lost its open state on every re-render) to a manual ▸/▾ toggle backed by a module-level Set (quotePricingOpenIds) that survives re-renders. Feet/lights inputs switched from a 700ms input-debounce to save-on-blur.
P2 (test harness) — run-all.js was crashing on a colorComboKey extraction (that function is genuinely gone from admin.html, not renamed — left as a documented GAP, not restored). Several checks were stale (a fixed 9000-char extraction window that the Edit Customer save handler had grown past — now slices to the next real anchor instead of a magic number; a couple of renamed-variable and removed-feature mismatches; a CRLF-vs-LF banner search). jsdom is now actually installed and Suite 5 runs for real against the current (P1) card markup — it was silently skipped before, so nobody had noticed it was testing removed structure.
P3 (three small bugs) — fixed: warehouse buffer stock (warehouseExtras) now decrements quantity instead of deleting the whole doc on a tick. Fixed: Add/Edit Customer's "One-Time Notes" field was writing a plural oneTimeNotes field that nothing downstream read — unified to the singular oneTimeNote field that route stops, the crew portal, and completion-clearing already use. NOT a bug, despite the original P3 description: frontPhotoUrl reads in admin.html are the live manual-photo-upload feature that replaced the retired Street View lookup (confirmed by a code comment in index.html) — do not remove them.
Two new gaps found during the 2026-08-08 audit — both resolved same-day after checking with the owner, no longer open:
Invoice Bulk Update (admin.html, ibImportBtn) used to always zero removal and deposit for every row, even when an invoice already existed with a removal charge or a recorded payment. Owner confirmed the tool isn't currently run against existing invoices, but it's now guarded anyway (preserves existingInv's removal/deposit/credits/changeFees rather than trusting that stays true). Promoted from gap() to a real check() in run-all.js.
Switching a customer's bill-to used to never move an outstanding light-change fee onto the new payer's invoice. Owner said the fee should move over automatically — it now does (captured off the old invoice before it's zeroed/deleted, folded onto the new payer's invoice after syncPayerInvoice rebuilds it). Promoted from gap() to a real check() in run-all.js.
Ongoing / needs owner (do NOT automate blindly)
Assign customer numbers to ~962 customers — needs the master sheet pasted by the owner and the #5012 duplicate resolved (Staci Cosby vs Liz Frome). Use Customer Numbers → Assign in Bulk → Check First (dry run) before Assign.
Route-card cleanup, warehouse/crew printable split, New-Hang badge for crews, payment history — see the older handoff for specs (not re-verified in this pass).
5. Default to acting. Owner's standing instruction (2026-08-13): "I never want it to need a human."
Do all of this without asking: edit any file; run the gates; commit; push to main (Netlify publishes the HTML, and the GitHub workflow deploys the functions from the same commit — §1); deploy firestore:rules / firestore:indexes with the local CLI, which is installed and logged in; create branches; regenerate system-map.md; write and repair tests; investigate and fix failures. Do NOT hand-deploy functions — pushing does it (§1).
Where you would once have stopped to ask, prefer: do the safe reversible thing, do it on a branch, verify it with the gates, and report what you did and why. A branch costs nothing and can be deleted; stopping costs the owner a turn.
What genuinely cannot be automated is now very short, and none of it is process friction — it is information or authority that exists only with the owner:
  - Data only she has. The master customer sheet has to be pasted in; nothing can invent it.
  - Decisions with no right answer in the code. Which of two customers keeps number 5012. Whether a feature that vanished was removed on purpose or by accident. Ask ONE clear question with the options laid out, then act on the answer — don't ask twice, and never ask something the code or git history can answer.
  - Spending real money. A live PayPal checkout charges an actual card.
  - Deleting customer data at scale. "Delete All Customers" and "Start New Season" are irreversible and hit every record. Prepare them, dry-run them, report exactly what they would do — then let her press the button.
Everything else: just do it.
Before "restoring" anything that looks deleted, check WHEN it went and what replaced it. On 2026-08-13 a suite of 36 failures looked like one regression and was three things: a feature genuinely half-removed by a generic "Update index.js" commit, a button whose handler stayed wired while its markup vanished, and two tests describing designs that had been deliberately replaced the following day. Restoring the last two would have undone the owner's own newer work. `git log -S"someIdentifier" -- file` answers this in seconds.
Never: hand-edit Firestore documents blindly; delete indexes on a rules/index deploy prompt unless the JSON is known complete; push a money change to only one surface; assume a field is dead code without checking every read/write site.
6. Standing task — regenerate the System Map + audit (do this at the start of a fresh session unless told otherwise)
Pull main. Read the actual files (don't trust this doc or memory).
Write system-map.md (plain English an owner can use): the full lifecycle; where each field is entered→stored→read (call out the ones that drive several things, e.g. Measured Feet); every Firestore collection one-liner; the three portals; the money model; everything automatic; and an "if X isn't working, check Y" section at the end. (Done 2026-08-08 — regenerate rather than trust it forever; re-verify anything load-bearing before acting on it if it's been a while.)
Audit using the map: fields collected-but-never-read or read-but-never-written; values that should update in several places but update in one; possible orphans (deleted customer on a route, invoice with no customer, number held by nobody); the same number computed twice that could disagree. For each: what breaks, who notices, how bad.
Add a gap() check to run-all.js for every gap found (the helper reports without failing the build and self-heals to PASS when fixed). Then report and ask before fixing production behaviour. When writing a gap() check's "fixed" condition, make sure it can't false-positive against unrelated code nearby — a naive substring/regex test can accidentally match a fix for a different bug that happens to sit in the same block (this happened once during the 2026-08-08 pass; caught before it shipped).
7. Hard-won lessons (verification traps)
Indexes/rules in the JSON/rules files are not deployed until you run the firebase deploy for them — a perfectly correct file can still throw failed-precondition. Netlify never touches Firebase.
firebase deploy --only firestore:indexes offers to delete console-made indexes absent from the file — say no unless the file is complete.
Scan for duplicate element IDs, not just missing ones (getElementById returns the first — a whole modal was once unreachable).
Missing markup fails silently under ?. optional chaining. Verify IDs exist in HTML, not just that JS runs without error.
Check <div vs </div> balance after any big HTML deletion; run node --check on extracted inline scripts.
Watch for undefined variables after a rename (grep the new identifier inside string concatenation).
str_replace/edits need exact whitespace and real characters — the files use literal em dashes (—), not &mdash;, in places. admin.html is CRLF (\r\n) throughout — a literal \n in a search/extraction string will silently fail to match; use \r?\n or a regex.
Firestore's long-poll Listen/channel "Fetch failed" console line is normal reconnection noise — not a bug.
A collection missing from firestore.rules is denied by default and fails silently in a listener — check the rules file first when a list renders empty.
A field can look orphaned from one read site and still be live from another — grep every read AND write site before calling something dead code (see §9 in system-map.md, frontPhotoUrl).
A fixed-length character-window extraction in a test (e.g. "next 9000 chars after this anchor") will silently go stale as the real code grows past it, turning true passes into false FAILs. Prefer slicing to the next real structural anchor over a magic number.
A Project To-Do checklist test's wording drifts the same way any other doc does — it doesn't auto-detect that a button got renamed. On 2026-08-08 five Admin quote tests (#19/20/30/31/33) still told the reader to open "the approval link" hours after that button had been renamed to "Send Email" in the same session; the owner caught it by actually reading a rewritten test's steps, not by any automated check. Whenever a change touches something a test describes, update+version-bump that TEST_SEED entry in the same change (see §0).
8. Current security note
The quotes collection is currently open to unauthenticated scoped updates (Option A) so the customer approve/detail flow works without a login. Price and all other fields stay staff-only. This is a deliberate, owner-approved tradeoff, unchanged in this pass. If future work re-introduces the function-based quote flow, re-tighten this rule to staff-only update and confirm the portal still saves through the functions.
9. Automated testing — rules, conventions, and how the pieces fit
Added 2026-08-14. Read this before writing any test or any selector.
9.1 The three test systems and what each is for
There are three, deliberately. Do not merge them and do not duplicate a check across them.
run-all.js (repo root) — structure, wiring, and logic read straight out of the source files. Fast, no browser. This is where "does admin.html still call this function", "do these two files agree about a field name", and the js/money.js unit tests live. Biggest suite, run on every change.
money-parity.test.js (repo root) — one job: prove the browser copy and the server copy of the money maths still agree. See §9.2.
Playwright specs (tests/) — real browser, real DOM, real click handlers, fake database. For user flows: filling the quote form, logging into the portal, editing an invoice amount, marking a house done. Slower, so keep it to flows that matter.
Project To-Do checklist (Firestore projectTests, TEST_SEED in admin.html) — the owner's manual sign-off list, 165 tests. NOT automated and not replaced by any of the above. When a Playwright spec covers a checklist test, put the checklist id at the front of the spec title — test('t11 — portal shows a PayPal button', ...) — so the two point at each other instead of drifting into two separate truths.
9.2 The money parity rule (the most important test in the repo)
The invoice maths exists TWICE and cannot be shared, because one runs as a browser ES module and the other runs on Node inside Cloud Functions:
  js/money.js          computeInvoiceStatus()        what the office sees
  functions/index.js   computeInvoiceStatusServer()  what the customer is actually billed
  js/money.js          custInvoiceKey()             which invoice a customer files under (admin)
  functions/index.js   invoiceKeyFor()              the same decision, server side
money-parity.test.js lifts all four out of the real files, runs them side by side over ~13,000 money combinations plus blank/text/broken inputs, and fails the moment the two disagree. It does not care what the formula IS — only that both copies say the same thing — so it keeps working when pricing rules change.
If you change one of these formulas, change the other in the same commit. If the parity test fails, the office screen and the nightly billing run disagree about someone's bill. Do not push. Do not "fix" it by editing the test.
If a rename makes the test unable to find one of the four functions, it FAILS loudly rather than skipping — that is intentional. A test that cannot find its target must never report green.
9.3 Selectors — how to target elements in a browser test
Prefer, in this order:
1. An existing id. admin.html is full of stable ids and gate C already checks every id referenced in JS exists. Use them: page.locator('#invoiceAmount').
2. data-testid, added only where there is no stable id, and only on elements a test actually touches. Add them AS YOU GO, not in a big sweep — a mass edit of a 21,000-line file is risk without benefit (owner's decision, 2026-08-14).
3. Visible text, for buttons whose label is the thing being tested.
Never use CSS descendant chains (.panel > div:nth-child(3) input) or XPath. They break on any layout change and produce failures that look like bugs but aren't.
Naming: data-testid="area-thing-action", lowercase and hyphenated — data-testid="invoice-amount-input", data-testid="quote-send-btn". A testid is part of the contract; renaming one is a change that needs its test updated in the same commit, exactly like a TEST_SEED entry.
9.4 Tests NEVER touch real Firebase
Non-negotiable. There are ~967 real customers and real money in that project.
Playwright serves the real HTML with a STUBBED Firebase module. No credentials in any config, any spec, any fixture, or any CI secret used by tests.
The stub must THROW LOUDLY if anything reaches a real Firestore or Auth endpoint. A test that silently falls through to production is worse than no test.
Never point a test at project highlighting-utah. If you ever genuinely need real backend behaviour, that is the Firestore emulator, it is a separate decision, and it needs the owner's say-so first.
This rule outranks getting a test to pass. If the only way to make a test work is to touch real data, the test does not get written.
9.5 Fixtures
One shared fixture file. Do not let each spec invent its own fake customer — they drift and then nobody trusts any of them. The fixtures must include the edge cases that have actually caused problems here: a multi-house billToPhone group, an email-only customer (no phone), a 260ft double-bin house (CN_DOUBLE_BIN_FEET, NOT the 200ft some old UI text still claims), a customer carrying carryoverCredit, and an unrated-difficulty house.
9.6 TDD — red, green, refactor
For a bug fix: write the failing spec FIRST, watch it fail for the right reason, then fix the code. A spec that has never failed has not been shown to test anything.
For a new feature: write the spec alongside the code, not after the fact. "After the fact" reliably becomes "never".
Start new browser coverage on the five known Member Portal failures (checklist tests 9, 11, 14, 15, 17) rather than on things that already work — those are real bugs with a real green state to reach.
9.7 Flaky tests
A flaky test is fixed or deleted. It is never retried until it goes green, and retries are never added to paper over one.
The reason is not purity: a suite with known-flaky tests trains you to dismiss failures, and then the real one gets dismissed too.
9.8 Speed budget
The whole of `npm test` stays under 60 seconds. If it creeps over, cut or parallelise — a suite slow enough to skip is a suite that gets skipped.
9.9 The standing rule — tests follow every change (owner's instruction, 2026-08-14)
Any change to the website updates its tests IN THE SAME COMMIT. Concretely, all four of these, whichever apply:
  1. the relevant run-all.js / Playwright check
  2. the TEST_SEED entry in admin.html, with its version bumped and a retestReason (§0, §7)
  3. RETIRED_CHECKLIST_TERMS in run-all.js, if the change retires a UI term a test used to describe
  4. money-parity.test.js, if a money function was renamed
Shipping code without its test update is not "finishing early", it is leaving a trap. This is the rule the owner asked for by name — do not skip it.
9.10 Deploy safety — decisions already made, do not re-propose
Canary / percentage rollout with automatic rollback: CONSIDERED AND REJECTED, 2026-08-14, with the owner's agreement. Do not build it and do not suggest it again without new information.
Why it does not fit: the site is three static HTML files on Netlify's CDN. A broken admin.html still returns HTTP 200 — it fails in the browser, not at the server. There is no 5xx spike for an auto-rollback to trigger on, so the whole mechanism would watch a signal that never arrives. On top of that, 5% of the admin audience is a fraction of one person (the owner, her mother, her father, the crew), and Netlify's split testing uses branch affinity, so whoever draws the canary is PINNED to the broken version while everyone else sees a working one — an unreproducible bug report by design.
What is used instead, and is enough at this scale:
  1. Netlify instant rollback. Every previous deploy is retained and republished in one click from the Netlify UI (Deploys → pick a known-good deploy → Publish deploy). This is the "roll back to the safe version" step, available in about fifteen seconds. Reach for it FIRST when something is wrong in production — diagnose afterwards, not before.
  2. Deploy previews. A branch deploy gives a real URL to look at before anything reaches main. At this scale that beats a canary: the person reviewing is the owner, who knows the system, rather than 5% of random traffic.
Firestore rules and Cloud Functions are NOT covered by a Netlify rollback — they are separate surfaces (§1). Rolling back the HTML does not roll back a functions deploy. If a bad change spanned both, roll back the HTML and then revert the functions commit so CI redeploys the previous version.
9.11 Production monitoring — read-only only
Synthetic monitoring of the LIVE site is approved in principle (Phase 5), with one hard limit: checks are READ-ONLY.
Never write a synthetic that exercises a write path in production. The obvious "log in, add to cart, check out" pattern maps here to creating a real quote in the quotes collection — at one run every ten minutes that is roughly 4,300 junk quotes a month landing in the office queue, plus whatever a synthetic payment does to invoice data. A write-path synthetic would need a designated test customer excluded from every list, route, invoice and export; that is its own project and has not been approved.
Safe checks: does the public site load, does the portal login function respond, does admin.html load with a clean console, is the Cloud Function answering.
Cost note (verified 2026-08-14): Checkly's free Hobby tier allows 1,000 browser check runs and 10,000 API check runs a month. A browser check every 15 minutes is ~2,880 runs and overruns the free tier three times over; hourly is ~720 and fits. A light API check every 5 minutes is ~8,640 and fits. So: API checks frequent, browser checks hourly. A scheduled GitHub Actions workflow running the same Playwright specs against production is the $0 alternative.
The highest-value monitor already exists and predates all of this: the nightly billing summary text and the stale-run banner (§6 of system-map.md). Do not let a monitoring project quietly replace them — they watch the thing most likely to silently cost money.
