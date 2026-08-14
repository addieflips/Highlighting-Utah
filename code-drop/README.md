# Code Drop

A place to paste code without touching anything live.

There is one file per person:

| File | Who |
|---|---|
| `addie.md` | Addie |
| `dax.md` | Dax |
| `jonny.md` | Jonny |

## How it works

1. **Paste your code into your own file.** Doesn't need to be tidy, finished, or working.
2. **Commit it.** On GitHub that's the green *Commit changes* button.
3. **Tell Claude** it's there — "I dropped something in `code-drop/addie.md`".
4. Claude reads it, works out where it belongs, puts it in the real code, runs the tests, and tells you what it did.

## Why not just paste straight into `admin.html`?

Two reasons.

**GitHub won't let you.** `admin.html` is about 1.5 MB and GitHub's browser editor refuses to open files over 1 MB — there's no pencil icon on it at all.

**And one stray character breaks the whole admin page.** Everything the office uses lives in that one file. A single missing bracket takes out Customers, Routes, Invoices, all of it, for everyone, within a minute of pushing.

Dropping code here has neither problem. Nothing in this folder is loaded by the app, the website, or the Cloud Functions. It is completely inert — you cannot break the business by pasting in here, however wrong the code is.

## Nothing here goes live on its own

Files in this folder are never published or run. They're a staging area. Code only becomes real when it's been moved into `admin.html`, `index.html`, `employee.html`, or `functions/index.js` — and that happens after the test suite passes.

## It's fine to leave notes instead of code

"The invoice list should sort by oldest unpaid first" is just as useful as code. Write whatever's easiest.
