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
Keep the Project To-Do checklist truthful. Any change that alters what a checklist test (TEST_SEED in admin.html) describes — a renamed button, a moved feature, changed behavior — needs that test's wording fixed and its version number bumped in the same change, or it silently goes stale (see §2 and §7). When a change retires a UI term a test used to describe (a renamed button, a removed label), add it to RETIRED_CHECKLIST_TERMS in run-all.js in the same commit — that's what actually fails gate B if this rule gets skipped, not just this sentence.
Stop and report if a task needs owner data (e.g. the master customer sheet) or an irreversible decision.
1. Stack & deploy commands (your automation primitives)
Three static HTML files + Firebase backend + Netlify hosting. No build step for the HTML.
File	What it is
index.html	Public site + the customer Member Portal
admin.html	Office dashboard (~1.4MB; two inline scripts — a plain one and a <script type="module">, which is the app itself)
js/money.js	The invoice and bin rules, pulled out of admin.html so they can be unit-tested (computeInvoiceStatus, statusClass, enrollmentYearOf, custInvoiceKey, cnBinsForFeet, fmtMoney, CN_DOUBLE_BIN_FEET). Imported by admin.html's module script — native browser modules, still no build step. ⚠ functions/index.js keeps its own copy of the invoice maths for the nightly run: change a rule in one and change it in the other, in the same push.
employee.html	Crew/Warehouse Portal
functions/index.js	Cloud Functions (Firebase v2, Blaze)
firestore.rules / firestore.indexes.json	DB security + indexes
run-all.js, quote-card.test.js	Test suite (see §3) — needs `npm install` once at repo root (installs jsdom; package.json/package-lock.json are committed)
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
python3 - <<'PY'
import re
for f in ['index.html','admin.html','employee.html']:
    s=open(f,encoding='utf-8').read()
    js='\n;\n'.join(re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>', s, re.S))
    open('/tmp/'+f+'.js','w',encoding='utf-8').write(js)
    o,c=len(re.findall(r'<div\b',s)),len(re.findall(r'</div>',s))
    print(f, 'div', o, c, 'OK' if o==c else 'MISMATCH')
PY
node --check /tmp/admin.html.js && node --check /tmp/index.html.js && node --check /tmp/employee.html.js
(This still works now that admin.html's module script contains an `import`, because Node 22+ auto-detects module syntax in a .js file. Verified on Node v24.19.0. On an older Node it would fail with "Cannot use import statement outside a module" — if that happens, extract the <script type="module"> block to a .mjs file and check that separately.)
node --check functions/index.js
(On Windows/Git Bash, /tmp may not exist — write the extracted JS to your scratchpad directory instead and node --check that path.)
B. Test suite. The suite lives at repo root but its code expects a tests/ subfolder (__dirname/'..'). Run it via a shim:
bash
mkdir -p tests && cp run-all.js quote-card.test.js tests/ && (cd tests && ln -s ../node_modules node_modules 2>/dev/null; node run-all.js); rm -rf tests
Needs `npm install` once at repo root (jsdom — package.json is committed). Without it, Suite 5 (quote card rendering) silently skips instead of running — don't mistake that for a pass. GAP lines are known disconnects (non-blocking, self-heal to PASS when fixed). Real regressions show as FAIL. A change is only clean if it introduces no new FAIL and doesn't turn a PASS/gap closed back into a GAP/FAIL. As of 2026-08-13: 224 passed, 0 failed, 3 notes, 1 GAP (colorComboKey — a helper the suite still expects that admin.html no longer has; either restore it or delete those checks). Suite 4 now also unit-tests js/money.js directly, which is why the count jumped.
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
5. What you can automate vs what needs a human
Automate fully: editing any file; running the verification gates; committing; git push (HTML → Netlify auto-publishes); firestore:rules / firestore:indexes deploys (the CLI is installed and logged in — see §1); regenerating system-map.md; adding/repairing tests. NOTE: do NOT hand-deploy functions — pushing to main does it via GitHub Actions (§1).
Needs a human: git credentials; anything requiring the master customer sheet or a business judgement call (which duplicate keeps a number, whether to re-lock the quotes rule, whether a removed feature was removed on purpose); a real PayPal test checkout; approving irreversible data changes.
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
