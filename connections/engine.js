/* DECLARED vs FOUND
 * =================
 * Confirms that connections somebody DECLARED still exist in the code, and reports
 * anything touching the same field that nobody declared.
 *
 * ⚠ IT PROVES A CONNECTION EXISTS. IT NEVER PROVES ONE IS CORRECT. A writer that sets
 * the wrong value, or sets it conditionally when the rule says ungated, is GREEN here.
 * That limit is the whole reason the map has to say so on its own face — a page that
 * looks complete and is not is worse than no page.
 *
 * WHY THERE ARE TWO LISTS AT ALL. A map generated purely from the code can never go
 * red: a missing connection is simply a missing arrow, and a missing arrow looks exactly
 * like a line that was never meant to be there. That is the Back Next Year bug precisely
 * — six readers all working, nothing writing the flag, and a generated picture would
 * have drawn six clean arrows and told you nothing. So:
 *
 *   GREEN  declared and found          the connection is there
 *   RED    declared and NOT found      somebody removed it, or it never landed
 *   AMBER  found and never declared    an undeclared writer, which is how
 *                                      needsLightRecycle came to be re-derived on save
 */
'use strict';
const { index, enclosing, sectionFrom } = require('./scan');

/* ---------------------------------------------------------------------------
 * Anchors. Three kinds, each pinned to something real and checkable:
 *   fn:   'whBuildQueueGroups'          a named function
 *   el:   'rbImportBtn'                 an element handler, from its id forward
 *   near: 'if(warehouseRebuildFields('  a unique marker inside an anonymous handler
 *
 * ⚠ NO `span`. The prototype took a character count and CLAUDE.md §7 bans exactly that:
 * a generous window from one element id runs straight into the next handler, and the
 * first then appears to contain the second one's code. Every range ends at the close of
 * its enclosing top-level construct instead.
 * ------------------------------------------------------------------------- */
function anchorRanges(ix, a) {
  const out = [];
  if (a.fn) ix.fns.filter(f => f.name === a.fn).forEach(f => out.push([f.start, f.end]));
  if (a.el) {
    const re = new RegExp(
      "(?:getElementById\\(\\s*['\"]" + a.el + "['\"]|querySelector\\(\\s*['\"]#" + a.el + "['\"])", 'g');
    let m;
    while ((m = re.exec(ix.src))) out.push([m.index, sectionFrom(ix.src, m.index)]);
  }
  if (a.near) {
    let i = ix.src.indexOf(a.near);
    while (i > -1) { out.push([i, sectionFrom(ix.src, i)]); i = ix.src.indexOf(a.near, i + 1); }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * Where a field is touched, and whether that touch is a write or a read.
 *
 * ⚠ WORD-BOUNDED. The prototype used a bare `new RegExp(field)`, so `completedAt`
 * counted as `completed` and `difficultyWhy` as `difficulty`. Two collisions in the real
 * files today — small, but they land in AMBER, and amber that carries known-false rows
 * is amber nobody reads.
 *
 * ⚠ RUN AGAINST THE BLANKED SOURCE, matched at real offsets. See scan.js: comments are
 * replaced by spaces rather than removed, so a comment naming the field cannot satisfy
 * anything while every position still lines up with the real file.
 * ------------------------------------------------------------------------- */
function hits(ix, field) {
  const out = [];
  const re = new RegExp('\\b' + field + '\\b', 'g');
  const s = ix.blanked;
  let m;
  while ((m = re.exec(s))) {
    const after = s.slice(m.index + field.length, m.index + field.length + 14);
    const before = s.slice(Math.max(0, m.index - 2), m.index);
    let kind = null;
    const isProp = /[.[]$|['"]$/.test(before);
    /* ⚠ ASSIGNMENT FIRST, BECAUSE IT IS A WRITE EITHER WAY. `updates.needsLightBuild =`
       and a bare `needsLightBuild =` are both writes; only the local-declaration rule
       below takes any of those back. */
    if (/^\s*=[^=]/.test(after)) kind = 'set';
    /* ⚠ A COLON AFTER A PROPERTY ACCESS IS A TERNARY, NOT AN OBJECT KEY. `d.completed ?
       'a' : 'b'` leaves the field followed by ` : `, and that used to be read as an
       object key and counted as a WRITE — ten across the map, in the more misleading
       direction, because a phantom writer on a money field is exactly what somebody would
       go and investigate. `x.field:` cannot be an object key in any valid JavaScript.
       ⚠ THE FIRST VERSION OF THIS PUT THE PROPERTY TEST AHEAD OF THE ASSIGNMENT TEST and
       broke twenty real declarations at once — every `updates.field = value` in the app
       became a read. Kept as a comment because the fix looks obviously right both ways
       round and is only correct one of them. */
    else if (/^\s*:/.test(after)) kind = isProp ? 'read' : 'set';
    else if (isProp) kind = 'read';
    /* ⚠ A LOCAL DECLARATION IS NOT A WRITE TO THE RECORD. `const completed = !!d.completed`
       reads the field and names a local after it; `let deposit = 0` names one after a field
       it never touches. Both matched `= ` and were counted as writers — 45 of them across
       the map, and they are the worst kind of amber because they sit inside functions that
       genuinely do handle the right record, so no record filter can see them.
       ⚠ THE DESTRUCTURING FORM IS DELIBERATELY NOT CAUGHT: `const {completed} = d` has a
       brace between the keyword and the name, so it does not match here — and it is a
       READ, which the branch above has already decided correctly. */
    if (kind === 'set' && /\b(?:const|let|var)\s+$/.test(s.slice(Math.max(0, m.index - 12), m.index))) {
      kind = null;
    }
    if (kind) out.push({ pos: m.index, kind });
  }
  return out;
}

const inAny = (ranges, pos) => ranges.some(r => pos >= r[0] && pos <= r[1]);

/* ---------------------------------------------------------------------------
 * IS THIS TOUCH EVEN ON THE RIGHT RECORD?
 *
 * Addie, 2026-08-31, having been told there were 760 undeclared touches, picked five
 * areas to work through. Measuring them first showed most of that number was not real:
 * `status` alone reported 184, and the list was `ccRenderCardList`, `ccStatusColor`,
 * `approveTimeOffRequest`, `renderExpensesList` — the status of a CREDIT CARD
 * TRANSACTION, a TIME-OFF REQUEST, an EXPENSE. `hits()` is word-bounded but knows
 * nothing about which record a field belongs to, and half a dozen collections in this
 * app have a field called `status`.
 *
 * ⚠ AMBER THAT CARRIES KNOWN-FALSE ROWS IS AMBER NOBODY READS — engine.js's own words,
 * written about a two-row collision. At 184 it stops being noise and becomes the reason
 * the column has never been worked through.
 *
 * ⭐ THE RULE, AND IT ONLY EVER DROPS WHAT IT CAN POSITIVELY IDENTIFY: a touch is
 * discarded when the function around it names OTHER Firestore collections and never
 * names this field's own. `renderExpensesList` says `expenses` and never `quotes`, so
 * its `status` is not a quote's. A function naming no collection at all, or naming this
 * one, or sitting outside any named function, is KEPT — "cannot tell" always means keep.
 * The cost of a false drop is a real connection going invisible, which is the failure
 * this whole page exists to prevent; the cost of a false keep is one more amber row.
 *
 * ⚠ IT REPLACES NOTHING. The hand-written `ignore` lists stay: they name functions that
 * genuinely touch the right record for a reason that is not a connection, which no
 * amount of collection-sniffing can work out. This runs after them.
 *
 * ⚠ AND THE COLLECTIONS ARE READ OUT OF THE SOURCE, never listed here. A hard-coded list
 * would go stale the day somebody adds a collection, and it would go stale SILENTLY —
 * the new collection would simply stop being recognised as "another record", and its
 * fields would start appearing as false amber on somebody else's spine.
 * ------------------------------------------------------------------------- */
const RECORD_COLLECTION = { cust: 'jobAddresses', inv: 'invoices', quote: 'quotes', route: 'scheduledRoutes' };
let COLLECTIONS = null;
function collectionsIn(ix) {
  if (COLLECTIONS) return COLLECTIONS;
  const found = new Set();
  const pats = [
    /\bcollection\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]/g,
    /\bdoc\(\s*db\s*,\s*['"]([A-Za-z0-9_]+)['"]/g,
    /\bdb\s*\.collection\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g
  ];
  Object.keys(ix).forEach(fk => {
    pats.forEach(re => { re.lastIndex = 0; let m; while ((m = re.exec(ix[fk].src))) found.add(m[1]); });
  });
  COLLECTIONS = [...found];
  return COLLECTIONS;
}
/* The SMALLEST named function containing this offset, with its range — `enclosing()`
   returns only a name, and the name is not enough to read the body. */
function fnRange(I, pos) {
  let best = null;
  for (const f of I.fns) {
    if (f.start <= pos && pos < f.end && (!best || (f.end - f.start) < (best.end - best.start))) best = f;
  }
  return best;
}
function otherRecord(ix, I, pos, spine) {
  const mine = RECORD_COLLECTION[spine.record];
  if (!mine) return false;                       /* an unknown record: cannot tell, keep */
  const f = fnRange(I, pos);
  if (!f) return false;                          /* a handler: cannot tell, keep */
  const body = I.blanked.slice(f.start, f.end);
  if (new RegExp('\\b' + mine + '\\b').test(body)) return false;   /* names its own record */
  return collectionsIn(ix).some(c => c !== mine && new RegExp('\\b' + c + '\\b').test(body));
}

function check(files, manifest) {
  const ix = {};
  Object.keys(files).forEach(k => { ix[k] = index(files[k]); });
  return manifest.map(spine => {
    const rows = [];
    const declared = {};
    ['sets', 'reads'].forEach(side => {
      (spine[side] || []).forEach(c => {
        const I = ix[c.file];
        /* ⚠ THE ANCHOR TRAVELS WITH THE ROW. Two rows can share a `where` — Quote
           Requests had a reader in quoteStage and another in quoteFolder — and a red
           naming only the `where` cannot say which. That sent me debugging the one that
           was fine. */
        const anchor = c.fn ? c.fn + '()' : c.el ? '#' + c.el : c.near ? 'near "' + String(c.near).slice(0, 40) + '"' : '?';
        const r = { side, where: c.where, when: c.when, file: c.file, anchor, rules: c.rules || [], found: false, why: '' };
        if (!I) { r.why = 'that file is not being scanned'; rows.push(r); return; }
        const ranges = anchorRanges(I, c);
        if (!ranges.length) {
          r.why = 'the anchor itself is gone from the file — it was renamed, moved, or removed';
          rows.push(r); return;
        }
        declared[c.file] = (declared[c.file] || []).concat(ranges);
        const want = side === 'sets' ? 'set' : 'read';
        r.found = hits(I, spine.field).some(h => h.kind === want && inAny(ranges, h.pos));
        if (!r.found) r.why = 'the anchor is still there, but it no longer ' + (want === 'set' ? 'writes' : 'reads') + ' this field';

        /* ⭐ `never` — A CONNECTION CAN BE PRESENT AND STILL WRONG.
         *
         * Everything above proves a connection EXISTS. Addie's whole reason for wanting
         * this page is to see ERRORS, and "the arrow is there" is a weaker claim than
         * "the arrow is right" — the live hole in attachAddressRowHandlers is exactly
         * that shape: it writes needsLightBuild perfectly happily, and writes the WRONG
         * VALUE. Existence-only, that box is green for ever.
         *
         * So a declared connection may also carry a pattern that must NEVER appear
         * inside its anchor. It is matched against the comment-blanked source, like
         * everything else here, so a comment describing the bug cannot trip it.
         *
         * ⚠ THIS IS NARROW ON PURPOSE. It cannot express "is the value correct" in
         * general — only "this exact broken shape is not present". A rule that needs
         * real reasoning belongs in a test, not in a dashboard. What it buys is that a
         * KNOWN hole shows up red on the page instead of sitting green until somebody
         * remembers it. */
        if (r.found && c.never) {
          const rx = new RegExp(c.never.pattern);
          const bad = ranges.some(range => rx.test(I.blanked.slice(range[0], range[1])));
          if (bad) { r.found = false; r.why = c.never.why; r.wrongValue = true; }
        }
        rows.push(r);
      });
    });
    /* Anything touching the field outside every declared anchor. */
    const extra = {};
    Object.keys(ix).forEach(fk => {
      const dr = declared[fk] || [];
      hits(ix[fk], spine.field).forEach(h => {
        if (inAny(dr, h.pos)) return;
        if ((spine.ignore || []).some(rx => new RegExp(rx).test(enclosing(ix[fk], h.pos) || ''))) return;
        if (otherRecord(ix, ix[fk], h.pos, spine)) return;
        const key = fk + ' · ' + (enclosing(ix[fk], h.pos) || '(a handler)') + ' · ' + h.kind;
        extra[key] = (extra[key] || 0) + 1;
      });
    });
    /* ⚠ THE COUNT IS PART OF THE ANSWER, NOT DECORATION — and this was found by
       red-checking, not by reading. Amber groups by function so the list stays readable,
       but the prototype then returned bare keys. A NEW undeclared writer added inside a
       function that already appeared was therefore completely invisible: the group was
       already listed, so nothing changed on screen. That is the amber equivalent of a
       false green, and `setCustomerSeason · set` is exactly the kind of function it
       would have hidden in. Carrying the count makes a second write in an old place show
       up as `×2`. */
    const undeclared = Object.keys(extra).sort()
      .map(k => extra[k] > 1 ? k + ' ×' + extra[k] : k);
    return { spine, rows, undeclared, undeclaredTotal: Object.values(extra).reduce((a, b) => a + b, 0) };
  });
}

module.exports = { check, hits, anchorRanges, otherRecord };
