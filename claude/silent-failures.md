# Nothing should fail quietly — the silent-failure map

---

## ⭐ Revision 3, 2026-08-26 — what was actually built

**Read this section first. Everything below it is revision 2, kept as the survey and
the reasoning, and its numbers are now history rather than current state.** Rerun
`python3 claude/sweep-silent-failures.py` for the live figures — it reads the real
files now (revision 2's copy had `/tmp` paths hard-coded, so from a clean checkout it
scanned nothing and printed "missing" three times, which looks exactly like a clean
repo).

### The bare-empty-catch count is zero, and a gate holds it there

`npm run test:silent` (`silent-failures.test.js`, its own file per R-018, wired into
`npm test`) asserts **no empty catch anywhere is left without a reason**, and names
the file, line and function of any new one. Revision 2's §10 argued for exactly this
in place of a count ceiling; this is that.

| | empty catches | bare |
|---|---|---|
| `admin.html` | 55 | **0** |
| `index.html` | 12 | **0** |
| `employee.html` | 6 | **0** |
| `functions/index.js` | 3 | **0** |

⚠ **`employee.html` IS swept now.** Revision 2 left it out as dormant-by-design, and
dormant turned out not to mean harmless: `whToggleRecycle` clears the customer number
off the record and *then* swallows the pool write, so a refused write left the number
on nobody's record and in no pool — the documented two-bins-one-label symptom, from a
third direction. Ticking again cannot even retry it, because the number is gone from
the record by then.

⚠ **The rule is a comment INSIDE the braces**, not near them. A comment three lines
above a `try` can be about anything, and code moves away from it.

⚠ **The gate red-checks itself every run**, against a fixture with a bare catch, a
commented one, a brace inside a string and a brace inside a comment. This is not
decoration: with the real count at zero there is nothing left in the repo for the gate
to find, so gutting the detection changes nothing and the build stays green. Every
file also asserts a floor on how many catch blocks were found at all — a brace matcher
that has quietly stopped matching reports no bare catches, which is a green build for
the worst possible reason.

### The seven that were not quiet on purpose

| Was | Now | Tier |
|---|---|---|
| A customer number that would not go in or out of the pool | `noticeCustomerNumberStuck` — a System note naming the number, which direction it went wrong, and what to type into Customer Numbers. Six call sites. | 3 (+ one toast per 15s) |
| A panel whose render threw | `safeRender` draws a bar naming the panel **in her words, read off her own nav**, with a Try again that re-runs that render | 2 |
| The automatic Health Check stopping | `bgJobFailed` — a System note after 3 failures in a row, saying when it last completed | 3 |
| `invoiceAutoSync` stopping | the same, with its own consequence spelled out | 3 |
| The route sweep's three customer writes | counted into `report.writeFailed` and put **first** in the reconcile note, where the length trim cannot reach it | 3 |
| "Send N to the build queue" reporting the list length | `9 of 12 sent`, naming the three that did not | 2 |
| "N stale pool entries removed" whatever happened | the count that really cleared, plus what would not | 2 |
| Cloudinary replying with something that is not JSON | the status code and the first of the reply, so "Cloudinary is down" and "the signature is wrong" stop looking identical | 2 (already surfaced) |
| `invoiceAutoSync`'s own `out.failed`, counted and never mentioned | in the activity line | 2 |

### Where each one is proved

Every one was **forced to fail and the signal asserted**, per §10 — not matched in the
source. Suite 108 (the Edit Customer save, run against a fake Firestore), Suite 38
(safeRender against a real DOM with nav buttons in it), Suite 71 (the reconcile note,
run), Suite 71b (the two bulk counts), Suite 79 (invoiceAutoSync, run). Roughly twenty
sabotages red-checked across them; three checks that were MISSED on the first pass are
recorded in the code beside the checks that replaced them.

### Two more, after the first pass

| Was | Now | Tier |
|---|---|---|
| `resyncSavedRouteStops` / `removeCustomerFromUpcomingRoutes` — `console.warn` (job 7) | one System note per save, naming the customer and the **dates**, because those are the sheets that must not be printed until it is sorted | 3 |
| The Inbox bulk actions (job 8) | the count was already honest — "9 moved, 3 failed" — but it then cleared **every** tick, so the three that failed were indistinguishable from the nine that worked the moment the toast went. They keep their tick now, and pressing again retries only them | 2 |

### `notifyBusinessOfMessage` — job 4, done from the other end

Revision 2 called this "tier 3 — the Inbox is the place that should notice". Trying to
make index.html notice was wrong: **the public site has no login**, and having it post
its own complaint into the Inbox would leave a note there on behalf of a customer who
asked for none. So it is split.

- **The sender says what happened.** Its `try/catch` never covered the common case —
  `emailjs.send` returns a **promise**, so a refused send was an unhandled rejection,
  not something that catch could see. The catch was documented and was wrong about
  what it was documenting. And two silent `return`s above it — no settings, no script
   — each stopped *every* alert for *every* customer for as long as they lasted.
- **The detector is a Health Check row**, `notifyOff`, on the screen the office
  already opens to be told something is wrong. It names *which* setting is missing,
  and says nothing at all until the settings have actually been read — `null` means
  "we do not know", and reporting the alerts as dead because a *read* failed is a
  false alarm on the one screen that must not cry wolf. (This exact fault has happened
  once: `settings/emailjs` was staff-only, the public site was denied it, and that
  "silently disabled every 'you have a new message' email".)

### Not done, and deliberately

- **The 843 silent early returns.** Still the right call — most are ordinary guards.
- **§6, silent-but-wrong.** Untouched. Still the most dangerous category and still its
  own job: nothing throws, nothing is caught, and a wrong number surfaces weeks later
  as a customer dispute.

---

*Revision 2, 2026-08-25. **Revision 1's numbers were wrong** — counted with a regex that only
matched short, single-level catch bodies. Recounted with a brace-matching scanner that blanks
strings, template literals and comments first, across all three sites. **Every figure below is
from that scan**, which ships beside this doc as `claude/sweep-silent-failures.py`.*

**Owner's rule, 2026-08-25: "nothing should fail quietly."**

---

## 1. ⚠ What revision 1 got wrong

| | Revision 1 said | Actually |
|---|---|---|
| `admin.html` empty catches | 38 | **67** |
| `admin.html` catches that tell the person | **15** | **112** |
| `functions/index.js` empty catches | **0 — "the server is clean"** | **3** |
| `index.html` | not swept at all | **41 catches, 14 empty** |
| Silent early returns | mentioned nowhere | **898 across the three sites** |

Wrong in **both directions**, and the "15" was the worse error: it painted the dashboard as
almost entirely silent when nearly half of all catches already surface something. Revision 1
also wrote 38 into a proposed regression test as a ceiling — a test that would have failed on
day one against a real count.

⚠ **The lesson is the one already in `CLAUDE.md`:** run the code, do not pattern-match the
source text. A regex that cannot match a brace cannot count braces.

---

## 2. The real shape

### Caught exceptions

| | total | **empty** | console only | tells the person | other\* |
|---|---|---|---|---|---|
| `admin.html` | 310 | **67** | 58 | 112 | 73 |
| `index.html` | 41 | **14** | 3 | 19 | 5 |
| `functions/index.js` | 31 | **3** | 24 | 0 | 4 |

\* *sets a flag, increments a counter, rethrows, returns a reason — not silent, not a message.*

**125 swallowed against 131 that surface.** Not the catastrophe revision 1 described, and not
fine either.

### ⭐ Most empty catches are already deliberate

| | empty | with a nearby comment explaining why | **bare** |
|---|---|---|---|
| `admin.html` | 67 | 50 | **17** |
| `index.html` | 14 | 8 | **6** |
| `functions/index.js` | 3 | 3 | **0** |

⭐ **Only 23 bare empty catches exist in the whole system.** The house style is already to say
why a failure is being ignored — *"logging must never break a save path"*, *"notification is a
nice-to-have, never block the actual save"*, *"private browsing or storage disabled — login just
won't be remembered"*. Those are correct and must not be touched.

**So the job is much smaller than it looked: 23 undocumented swallows, not 125.**

### Silent early returns — the failure mode revision 1 missed entirely

| | `if(!x) return;` style guards |
|---|---|
| `admin.html` | **842** |
| `functions/index.js` | 31 |
| `index.html` | 25 |

A function that returns because a record was missing, a field was blank, or a lookup came back
empty **never reaches a catch**. Nothing throws. This is how the route sweep's town bug behaved,
and how a house with a blank town sits out the season in silence.

⚠ **These cannot be swept as a group.** Most are ordinary guard clauses and correct. They are
listed here so nobody believes catch blocks are the whole problem.

---

## 3. ⚠ `index.html` was never swept, and it is the customer-facing one

A failure here is worse than any in the dashboard, because **you never learn the enquiry
existed.**

| Line | Function | State |
|---|---|---|
| 818 | `uploadPhotoToCloudinary` | **bare** — `JSON.parse(xhr.responseText)` in an empty catch. A malformed reply leaves `data` null and the promise rejects with "Upload failed", so it does surface — but the parse error is gone, and that is the difference between "Cloudinary is down" and "the signature is wrong" |
| 403, 405, 410, 414 | `navigate` | **bare ×4** |
| 2585, 2586, 2589, 2592 | `clearPortalLogin` / `savePortalCreds` / `clearPortalCreds` | **bare ×4** — storage writes; the sibling at 2582 carries the comment, these do not |
| 1237, 1246 | `logPortalSaveFailure` | documented — *"logging must never break a save path"* ✔ |
| 1253 | `notifyBusinessOfMessage` | documented — ⚠ **but the thing swallowed is the notification that a customer wrote to you.** Correct not to block the save; wrong that nothing else knows |
| 3047 | `notifyLightsChange` | documented — *"Firestore already has the updated colour either way"* ✔ |
| 2864 | `ensureJobAddressId` | console only |
| 3498, 3511 | `portalSidesWords` | console only — a cancel message that failed to flag |

⚠ **`employee.html` was not swept.** Dormant this season, by design — recorded so the omission
is deliberate rather than forgotten.

---

## 4. The pattern to fix them with — it already exists

Do not invent one. `sendPaymentReceipt` states the rule in its own docstring:

```
Returns {sent:true} or {sent:false, quiet:bool, why:'...'}.
quiet:true means "deliberately said nothing" — under the minimum, a
correction, or already receipted. Everything else is a real failure and
MUST be shown to whoever is standing there, never swallowed.
```

⭐ **Say which kind it is, in the code**, and let the quiet ones be quiet on purpose.

| Tier | Meaning | What it does |
|---|---|---|
| **Quiet on purpose** | A non-event. | Return a reason; write nothing. **Must carry a comment saying why.** 61 of the 84 empty catches already qualify. |
| **Say it now** | Someone is standing there and can act. | `toast()` or the panel's status line, in their words. |
| **Say it later** | Nobody is standing there — a sweep, a nightly job, a listener. | A **System note** or a banner, as the stale-run banner already does. |

⚠ **A background failure must never be tier 2.** A toast fired while the tab is in the
background is the same as no toast.

---

## 5. The ones that matter most, each opened and read

### ⭐ A customer number fails to go back in the pool

`formPreviewShow` (twice) and `rbApplyTickedAdds` write a released number back to
`availableCustomerNumbers` inside a `try` and log to the console; one is followed by a bare
`.catch(function(){})`.

**Not theoretical.** `system-map.md` already records the symptom without the cause: *"A customer
number appears on two houses → the return-to-pool step didn't run for the old holder. The Health
Check report finds them but can't auto-fix."* **These catches are how that happens.**
**Tier 3 — a System note naming the number.**

### ⭐ A panel that throws renders empty and says nothing

`safeRender` wraps every panel render and logs. `system-map.md` again records the symptom blind:
*"A section renders empty for no reason → check `firestore.rules` first."* **`safeRender` is the
silence** — an empty panel and a broken panel look identical.
**Tier 2 — render "This didn't load" with a Retry.** One change, every panel.

### ⭐ A customer wrote to you and the notification failed

`notifyBusinessOfMessage`, `index.html` line 1253. Correctly does not block the save — but
nothing else knows the notification never went. **The message is in Firestore; only the nudge is
lost.** **Tier 3 — the Inbox is the place that should notice.**

### The invoice auto-sync fails to the console

`invoiceAutoSync` — money reconciliation running in the background. If it stops, invoices and
customers drift and the first sign is a customer disputing a figure.
**Tier 3 — its own banner, like the nightly stale-run banner.**

### The route sweep gives up on the whole pass

`runReconcileAuto` turns any throw into one `console.error`, so one bad record abandons every
day that pass would have fixed. Documented in `state-of-play.md` §4; same disease.
**Tier 3 — a System note after N consecutive failed passes.**

### Health Check's own failures

`runHealthCheck` logs; `runHealthCheckAuto` has four empty catches commented *"never let a
background check break the page it is running behind."* The intent is right — but a health check
that silently stops checking is worse than none, because no warnings reads as good news.
**Tier 3 — "Health Check last completed …".**

### Route stop resync and stop removal

`resyncSavedRouteStops`, `removeCustomerFromUpcomingRoutes` — console warnings. A crew arrives
with a stale gate code, or at a house that cancelled. **Tier 3 — System note. The crew pays.**

### Inbox bulk actions

`msgBulkApply` and the toolbar delete log per-id failures. Tick twelve, move them, three quietly
do not move — the count still says twelve. **Tier 2 — "9 of 12 moved, 3 failed."**

---

## 6. Silent-but-wrong: the failures that never throw at all

Not one of these raises an exception. Firestore accepts every one of them.

| | What |
|---|---|
| `lightColors: []` | If the colour boxes are absent, the save writes an empty array over real colours. See `billing-groups.md` §3 — the reason the house tabs keep their colour boxes |
| **Back Next Year still billed** | The three billing filters test the bare string `'no'`, so a Back Next Year house is summed into the payer's invoice. `state-of-play.md` §6, Job 1 |
| **A street in the `city` field** | `extractCleanCity` passes any text with letters and no digits straight through, minting a town that earns its own crew-day. `state-of-play.md` §5 |
| **Overdue counted from `updatedAt`** | Correcting a spelling pushes a due date 30 days out and un-flags a genuinely overdue bill |
| **A blank column overwriting a good value** | Already fixed for five importer fields; the class remains wherever a write is unguarded |

⚠ **This category is the most dangerous and the least detectable.** No catch, no console line,
no red anything — just a wrong number that surfaces weeks later as a customer dispute. **A sweep
for these is a separate job and is not attempted here.**

---

## 7. What is already right — do not "fix" it

- **`sendPaymentReceipt`** — the model. Never throws, returns a reason, separates quiet from
  real. A failed email must not undo a recorded payment.
- **The nightly summary text and the stale-run banner** — the two real production monitors.
  Tier 3 done properly, and the template for everything above.
- **`askLightChangeFee`** — asks before writing, names the house, Cancel says *nothing is saved
  at all*.
- **The blocked block in the warehouse queue** — a house that cannot be built is *shown as
  blocked*, not hidden. The same instinct as this document.
- **The 61 documented empty catches** — each says why. That is the standard, already met.

---

## 8. What NOT to do

⚠ **Do not toast all 125.** Toast fatigue is the failure mode of surfacing everything: people
learn to dismiss without reading, and the one that mattered gets dismissed too.

⚠ **Do not add anything needing daily attention.** Standing rule. A System note when something
breaks is fine; a dashboard someone must check is not.

⚠ **Do not touch the 61 documented swallows.** They are correct and already explain themselves.

⚠ **Do not remove a catch to "let it throw."** In `admin.html` an uncaught throw in a listener
can stop a whole panel updating. The catch stays; what happens inside it changes.

⚠ **Do not attempt the 842 early returns as a group.** Most are ordinary and correct.

---

## 9. Order

| | What | Why first |
|---|---|---|
| 1 | **Customer numbers back to the pool** | The only one with a documented real-world symptom |
| 2 | **`safeRender` → "didn't load" + Retry** | One change, every panel, kills the blank-panel mystery |
| 3 | **The 23 bare empty catches get a tier and a comment** | Small, bounded; sets the standard the other 61 already meet |
| 4 | **`notifyBusinessOfMessage`** | Customer-facing; a lost message nudge is a lost customer |
| 5 | **`invoiceAutoSync` banner** | Money drifting in the background; the pattern exists |
| 6 | **Health Check "last completed"** | Cheap; makes a stopped checker visible |
| 7 | **Route resync / stop removal notes** | The crew pays |
| 8 | **Inbox bulk "9 of 12 moved"** | Small, visible |

**Separate small jobs, not one big one** — each independently testable and revertable.

---

## 10. Tests

**Force the failure and assert the signal.** A fake Firestore whose `setDoc` rejects, then assert
a System note was written or the status line changed. Same harness as the `syncPayerInvoice`
suite.

⚠ **Revision 1 proposed asserting the empty-catch count never rises. That does not work** — it
counts with the same flawed regex, and a count rising for a legitimate reason gives a red build
with no way to tell good from bad.

⭐ **Instead: every empty catch must carry a comment.** Once reviewed, a catch carries its reason
in the code, and the test asserts **no bare empty catch exists** — naming the file and line of
any new one. That scales, it says *which* one is new, and **61 of 84 already pass it.**

**Current bare count, the test's starting ceiling: `admin.html` 17, `index.html` 6,
`functions/index.js` 0.** `claude/sweep-silent-failures.py` is the scanner that produced every
number here; it ships with the doc so the counts are reproducible rather than re-derived.
