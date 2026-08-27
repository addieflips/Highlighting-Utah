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
    if (/^\s*:/.test(after)) kind = 'set';
    else if (/^\s*=[^=]/.test(after)) kind = 'set';
    else if (/[.[]$|['"]$/.test(before)) kind = 'read';
    if (kind) out.push({ pos: m.index, kind });
  }
  return out;
}

const inAny = (ranges, pos) => ranges.some(r => pos >= r[0] && pos <= r[1]);

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

module.exports = { check, hits, anchorRanges };
