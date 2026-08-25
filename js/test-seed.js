# Bug: Bulk Updates and Invoice Bulk Update don't set `needsLightBuild` when they ADD a customer

## Read first (repo is source of truth)

Repo: https://github.com/addieflips/Highlighting-Utah/tree/main

Read `CLAUDE.md` — the ⭐ BULK UPDATES IS RETIRED IN PRACTICE section documents this as two
deliberately-unfixed gaps. Read that whole bullet plus §5 (the duplicate diagnosis) before you
touch anything.

## What's wrong

In `admin.html`, the two importers `rbImportBtn` (Bulk Updates — the raw paste-the-columns
importer) and `ibImportBtn` (Invoice Bulk Update) both have an *add* branch that creates a new
`jobAddresses` record when no existing customer matches. Neither of those add branches writes
`needsLightBuild`.

So a customer created by either tool can have colours and wire colour saved on their record and
still never appear in the warehouse Needs Building queue — no bundle gets made, and the crew shows
up at a house with nothing for it. This is the same hole that was already closed on the
sheet-comparison path (`rbApplyTickedAdds`); these two were left open on purpose because the tools
were retired.

## What I want changed

1. In both add branches only, set `needsLightBuild: true` on the newly created record.
2. Gate it the same way the build queue and the existing hole-B fix gate it — a record only earns
   the flag if it actually has a light spec (colours / `lightsDescription`, or the wire/timer
   fields hole B added). A row with no light information at all is created without the flag, not
   queued.
3. Do **not** touch the update branch of either tool. An import that matches an existing customer
   must not flip `needsLightBuild` on them — that would re-queue houses that are already built.
4. Leave the blank-street guard (`if(!existing && !street){ failed++; continue; }`) exactly as it
   is. It's the only thing between a bad match and a repeat of the ~944-duplicate incident, and
   this change makes a bad match worse: a matcher that misses now queues the whole book for
   building on top of duplicating it.
5. Leave the batching alone — `BULK_CHUNK_SIZE`, the `hu.bulkImportJob.v1` localStorage job, the
   reload-and-continue banner. If the new flag depends on anything read outside the eighteen
   `rbAreaIds` boxes, it has to travel in the saved job (Suite 41 enforces this).
6. Nothing else changes. No money code, no invoice math, no build-queue rendering, no `whGroupKey`.

## Before you write code

Tell me your plan and its blast radius — which two functions, which lines, and what happens on the
next real 900-row press if the matcher misjudges a row. I'll approve before you change files.

## Tests

Add checks to `run-all.js` that **execute** the add path on its own (fake Firestore, same technique
as the `syncPayerInvoice` harness — not regex on source):

- add-with-colours gets the flag
- add-with-no-lights does not
- update-an-existing-customer leaves the flag untouched
- blank-street row is still refused

Give me the before/after pass count.

## Then sweep for the same holes elsewhere, and for dead code — report only, change nothing

### Holes

Every other place in the codebase that creates or revives a `jobAddresses` record and could leave
`needsLightBuild` unset when it shouldn't, or set when it shouldn't. Walk each entry point and say
which side of the line it lands on:

- Add-a-Customer
- Quote conversion
- The sheet-comparison adds (`rbApplyTickedAdds`)
- Start New Season
- Rejoin-after-recycle, in both `admin.html` and `functions/index.js`
- The two split buttons — Recycle Their Old Set / Build Them A New Set
- Member Portal writes
- Anything in `functions/index.js` that writes the flag

Same question for the flag's mirror image, `needsLightRecycle`. For each one: file, function, what
it does today, and whether that's right or a hole.

### Dead code

Functions, handlers, buttons, constants, and `run-all.js` suites that nothing reaches any more,
especially around the retired importers. Sort what you find into three buckets and don't blur them:

- **Safe to delete** — provably unreferenced, no UI hook, no test depends on it.
- **Looks dead but isn't** — reached by a string-built id, an inline `onclick`, a localStorage
  resume path, or a test harness that lifts it out and runs it alone. This bucket is the point of
  the exercise; the batching resume and the `_flipAutoSetFor` state are exactly the shape of thing
  that reads dead and isn't.
- **Retired but deliberately kept** — the raw importers themselves are the example. Still works,
  still in the page, just not the tool to reach for. Not dead.

Give me a table, and for anything you'd delete, say what breaks if you're wrong.

**Do not delete anything in this pass.** Per project rules, existing features don't get removed
unless I ask. I'll pick from the list.

## Docs

Update the ⭐ bullet in `CLAUDE.md` so it no longer says these two gaps are unfixed, and record what
the gate is and why the update branch was left alone. Add the sweep's findings as a short section
so the next session doesn't re-derive them.

## Output format

When you're done, give me the full contents of **only the files I need to upload** — no snippets,
no diffs, no files that were only discussed.
