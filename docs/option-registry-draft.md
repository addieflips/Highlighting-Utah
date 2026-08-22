# Option registry — draft for review

**Status: ADOPTED 2026-08-21. `js/options.js` now holds this registry and
`options-audit.test.js` gates it in CI.**

⚠ Adopted is not wired. Nothing imports `js/options.js` yet — plan §3.3, making
the eight artifacts render from it, has not been done. Until then this is the
SPEC and the artifacts are still hand-written, so a change here does not reach a
screen. This document stays as the reasoning behind each row.

Every row was derived from the code; the destinations in §2 are Addie's answers.
§5 is settled. §7 carries one thing that must not be done yet.

---

## 1. Where this came from

| Source | What it settles |
|---|---|
| `quoteDetailForm` submit handler, `index.html:2702` | **the customer-facing list** — what a new customer is actually asked for |
| `PORTAL_WRITE_FIELDS` / `PORTAL_READ_FIELDS`, `functions/index.js:554` | what a member may change and see later |
| `PRINT_COLUMNS`, `admin.html` | what actually reaches paper |
| Add Customer form (`addCust*` ids) | what the office sets that the customer never sees |

---

## 2. The registry

**⚠ EIGHT DESTINATIONS, NOT FIVE.** `js/options.js` ships a `CONSUMERS` list of
five (`quote`, `confirmation`, `crewSheet`, `pullList`, `invoice`) and R-003
names six, adding the customer record. Addie's answers name two more that are
neither: **Routes** and **Schedule**, which are genuinely separate surfaces —
Schedule is the season laid out day by day (`routeSchedule/plan`), Routes is the
crew's driving order for one day (`scheduledRoutes`). `CONSUMERS` has to grow to
eight, and `audit()` with it.

| # | Option | Field | Price? | Quote | Conf | Cust | Crew | Pull | Route | Sched | Inv |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Measured feet | `measuredFeet` | **YES** | ✓ | **✓ new** | ✓ | – | ✓ | – | – | ✓ |
| 2 | Light colours / pattern | `lightsDescription`, `lightColors` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 3 | Wire colour | `wireColor` | no | ✓ | ✓ | ✓ | – | ✓ | – | – | – |
| 4 | Timer | `outletTimer` | no | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| 5 | Plugs / eaves | `useEaves` | no | ✓ | – | ✓ | ✓ | – | – | – | – |
| 6 | Which outlet | `specificOutlet`, `specificOutletNotes` | no | ✓ | ✓ | ✓ | **✓ new** | – | – | – | – |
| 7 | Gate code | `gateCode` | no | ✓ | ✓ | ✓ | **✓ new** | – | – | – | – |
| 8 | Sides of the house | `houseSides` | no¹ | ✓ | ✓ | ✓ | **✓ new** | – | **✓ new** | **✓ new** | – |
| 9 | Install timing | `installPreference` | no | ✓ | ✓ | ✓ | – | – | – | ✓ | – |
| 10 | Notes | `notes` | no | ✓ | – | ✓ | ✓ | – | **✓ new** | **✓ new** | – |
| 11 | One-time note | `oneTimeNote` | no | – | – | ✓ | **✓ new** | – | **✓ new** | **✓ new** | – |
| 12 | Mailed invoice | `wantsMailedInvoice` | no | ✓ | – | ✓ | – | – | – | – | **✓ new** |
| 13 | Bins | `numberOfBins` | no | – | – | **✓ new** | – | ✓ | **✓ new** | **✓ new** | – |
| 14 | Difficulty | `difficulty` | no | – | – | ✓ | – | – | **✓ new** | **✓ new** | – |

**✓ new** = a destination Addie added that the option does not reach today.
**–** = deliberately not there.

¹ **Sides does not have its own price.** Changing it raises a re-quote because
the *footage* changes, and the footage is what is charged. Recorded explicitly so
nobody later adds a per-side surcharge: Addie, 2026-08-21 — *"Nothing but feet
should affect price."* ⚠ The comment at `functions/index.js:1066` says changing
sides "changes the PRICE", which is true only through feet. Do not read it as a
second price input.

---

## 3. The crew rule

> *"Everything saved in crew should also print on the schedule sheet we print off."*
> — Addie, 2026-08-21

That is a general invariant, not a per-option answer, and it closes three of the
four holes in §4 by itself. Proposed as **P-003** in `docs/RULES.md`. It is
testable — the printed sheet's columns can be checked against what the crew
portal renders — so it can be `code`-enforced rather than remembered.

---

## 4. The four holes, and where they now stand

| Hole | Status |
|---|---|
| **a.** Gate code shows in the crew portal, never prints | **Closed by the crew rule.** Row 7 gains Crew. |
| **b.** `useEaves` prints, but is absent from the crew portal | **Still open** — this one runs the *other* way, so the crew rule does not reach it. The printed sheet is right; the portal is missing it. |
| **c.** Which-outlet instructions never print | **Closed by the crew rule.** Row 6 gains Crew. |
| **d.** Side count reaches neither crew surface | **Closed explicitly.** Addie: sides go to Routes and Schedule, and the crew rule carries it to paper. |

---

## 5. The confirmation — settled

**① It is the RSVP email, not a new message, and it goes by EMAIL not SMS.**
Addie, 2026-08-21: *"This is for emails we don't have twillo and this would be
for RSVP emails."*

⚠ **Plan §4.2 is wrong on both counts.** It says *"Send `confirmationText(customer)`
via the existing Twilio path, N days before the scheduled install date."* The
Twilio code exists (`sendSms`, `twilioSendRaw`) but the service is not in use, and
the confirmation is not a separate pre-install message — it is the RSVP email
that already goes out at the start of the season through Automation Emails.

Two consequences, both good:

- **Phase 2 shrinks a lot.** There is no new send path, no new template system and
  no new scheduler. The RSVP email exists, has a token flow, and already carries
  `{{houses_block}}`. The option list becomes a block inside it.
- **Q-005 is moot.** "How many days before install?" was the wrong question — the
  RSVP goes out once at season start, before anything is built, which is *earlier*
  and therefore better: there is still time to change everything.

⚠ The one thing it does not do is catch a change made *after* the RSVP. A
pre-install confirmation would. Recorded rather than argued — Addie decided, and
the RSVP catches far more for far less work.

**② Plugs / eaves comes off the confirmation entirely.**
Addie: *"Okay lets get rid of eaves if it will cause more confusion."*
Row 5's `Conf` is now `–`. **No R-002 exception is needed** — the rule is about
an option that *is* on an artifact rendering `none` rather than a blank, not about
which options appear at all. Cleanest possible resolution.

---

## 6. Answered

- **Anything sold that has no row?** No — the list is complete. The placeholder
  `js/options.js` guessed at wreaths and walkways; neither exists in this business.
- **Anything but feet affecting price?** No. Feet only.
- **Confirmation list:** measured feet + price, light colours, wire colour, timer,
  which outlet, gate code, sides, install timing. Not eaves, not notes, not the
  internal rows.

---

## 7. ⚠ "Straight yes only" — already built, and DO NOT FLIP IT YET

Addie, 2026-08-21: *"straight yes is the only thing to count for RSVP for the season."*

**That switch already exists**, left by an earlier session for exactly this moment:

```js
const SEASON_ELIGIBILITY = 'all-but-maybe-next-year';   // or 'confirmed-only'
```

`isOutForSeason` already implements the `confirmed-only` branch, and `run-all.js`
already tests BOTH modes so the branch cannot rot before it is switched on. The
comment above it records the earlier instruction it was built for: *"for now we
want anyone who isnt maybe next year to be on the list but we will change it to
only confirmed on the scheduled list eventually."*

**⚠ FLIPPING IT TODAY EMPTIES THE SEASON.** Nobody has been sent an RSVP yet, so
almost every customer is unanswered, and `confirmed-only` puts every one of them
out. No routes, no builds, no installs. The existing comment says it in as many
words: flip it *"when the RSVP email is live and everyone has actually been
asked."* The order is: send the RSVP → let people answer → then flip.

**⚠ AND `confirmed-only` IS NOT CURRENTLY A *STRAIGHT* YES.** It tests
`rsvpStatus === 'yes'` and nothing else. But converting a quote writes
`rsvpStatus: 'yes'` at creation **with no `rsvpRespondedAt`** — the office knows
they want lights; nobody has asked them about *this season*. So a converted
customer would count as confirmed without ever answering.

The stricter test already exists a few thousand lines away, in the Excel "Yes"
tab: `if(said === 'yes' && d.rsvpRespondedAt) return true;` — with a comment
saying precisely why the timestamp is needed. **Two places decide "did they
really say yes" and they disagree.** If "straight yes" is meant literally,
`isOutForSeason` needs the same `&& rsvpRespondedAt`.

Raised as **Q-010**. Nothing has been changed.

---

*Derived 2026-08-21, revised the same day with Addie's answers. `js/options.js`
still holds its original placeholder set and is still imported by nothing.*

---

## 8. Corrections after review (2026-08-21)

**① The install-timing "hole" was not a hole.** I reported that the quote form
offers three timings while admin's vocabulary has five, and called it drift —
one option with two vocabularies. Addie: *"I don't want members to have the
option for before or after thanksgiving we only accept these if they ask for
them."*

So the record accepts five and a form offers three, **on purpose**. The two
Thanksgiving timings reach a record when a customer asks in conversation and the
office types it, or from the master sheet (`THX`) — never from a form. Offering
them would invite every customer into a window the season can only honour for a
few, which is the opposite of what `PRE_THANKSGIVING_DAYS` protects.

That policy now lives in the registry as `customerChoices`, with
`offerableChoices()` as the accessor a form must use, so the next reader finds
the answer instead of re-reporting it as a bug. The audit refuses an offerable
value the record cannot hold, and refuses an option that narrows what a customer
may pick without being on the quote form.

⚠ Worth naming as a pattern: *two vocabularies for one field looked like drift
and was an unwritten policy.* The registry's job is as much to record deliberate
narrowing as to catch accidental gaps.

**② Sides of the house: 1 to 4, and always was.** A customer picks 1, 2, 3 or 4
— that has been true since 2026-08-19, when four named sides were replaced by a
count. Nothing limits anyone to one side.

**③ And the side-count default was not a bug either — withdrawn.** I flagged
`houseSideCount` returning 1 for an unanswered count as R-002's failure in
disguise. Addie: *"if not answered the system can automatically choose 1."*

She is right, and the reason is stronger than preference. It is written at
`functions/index.js:1079`: that value is **one half of
`updates.houseSides !== before`, which raises a re-quote.** A default on one side
of that comparison and a blank on the other sends a re-quote to every customer
whose sides were never written down, for a change nobody made. The registry
briefly returned `undefined` for a blank — which would have been a **fourth**
reading of one field, disagreeing with the three that exist. That was the bug,
not the default.

⚠ Which surfaces a real duplication: `houseSideCount` (admin.html:17643),
`portalSideCount` (index.html:4695), `asCount` (functions/index.js:1083) and now
the registry are **four copies of one normaliser** — the same shape of problem as
the invoice maths. When the registry is wired (§3.3), the other three should call
it instead of keeping their own.

---

## 9. A note on how these three were found

Two of my three "findings" were wrong, and both in the same way: **existing
behaviour that looked like a defect was a deliberate decision nobody had written
down.** The Thanksgiving spread was a policy; the side default is load-bearing
for re-quote stability.

The tell in both cases was available and I did not look for it — a comment
explaining WHY, a few thousand lines away, in a file I had not opened. The
working rule for the rest of this plan: before recording existing behaviour as a
hole, find out why it is that way. `git log -S` and the comment beside the code
answer it in seconds, and the registry is a better place to record the answer
than a bug list.

---

## 10. ⚠ THE EMPLOYEE PORTAL IS NOT IN USE THIS SEASON (2026-08-21)

Addie: *"FYI were not using the employee portal this year."* This changes three
findings above and makes one of them considerably worse.

**Four fields now reach NOBODY.** Each of these lives in the crew portal and has
no column on any printed sheet, so with the portal out of use there is no channel
left at all:

| Field | crew portal | printed sheet | reaches |
|---|---|---|---|
| `gateCode` | ✓ | ✗ | **nobody** |
| `specificOutletNotes` | ✓ | ✗ | **nobody** |
| `oneTimeNote` | ✓ | ✗ | **nobody** |
| `difficulty` | ✓ | ✗ | **nobody** |

Hole (a) in §3 was written as *"a crew working off the printed sheet arrives at a
gated house with no code."* It is now simply *"nobody has the code."*

**Hole (b) is withdrawn.** `useEaves` printing but missing from the crew portal
was a real asymmetry when both surfaces were in use. Paper is now the only
surface, and `useEaves` prints, so there is nothing to fix.

**P-003's framing changes, its substance does not.** It was written as "keep the
two crew surfaces in step". The rule that matters this season is simpler: **paper
is the only surface, so anything the crew needs must print.** Worth rewording
before it is promoted.

**✅ Billing is NOT affected, checked rather than assumed.** `completed: true` is
written by the crew portal (`employee.html:2873`) *and* by admin — the Mark Done
control and the per-customer toggle at `admin.html:31027`. So houses can still be
marked done from the office and the nightly invoice run still fires. This was
worth checking: if the portal had been the only writer, not using it would have
stopped billing silently.
