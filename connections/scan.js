/* WHICH FUNCTION IS THIS OFFSET INSIDE?
 * ====================================
 * A function indexer for admin.html / index.html / functions/index.js. Given any byte
 * offset it names the smallest named function enclosing it, which is what turns a raw
 * "something touches this field at offset 412903" into "computeColorDemand reads it".
 *
 * ⚠ IT INDEXES NAMED FUNCTIONS ONLY. A great deal of this codebase lives in anonymous
 * addEventListener handlers, and those come back as null — the caller renders them as
 * "(a handler)". That is a real limit, not a bug to fix here: naming them would mean
 * guessing from the nearest element id above, which is exactly the kind of inference
 * that produces a confident wrong answer.
 */
'use strict';
const fs = require('fs');

/* Inline <script> blocks, with their offset in the original file so every position this
   module reports is an offset into the FILE, never into an extracted fragment. A .js
   file has no script tags and is returned whole. */
function scripts(src) {
  if (!/<script/i.test(src)) return [{ off: 0, code: src }];
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) out.push({ off: m.index + m[0].indexOf(m[1]), code: m[1] });
  return out;
}

/* Walk from the opening brace to its match, skipping strings, template literals and
   comments. Regex literals are NOT handled — a `/` followed by a brace inside a regex
   could in principle throw the count off; in practice every case in these three files
   is balanced, and the caller's landmark assertions would catch it if that changed. */
function matchBrace(code, open) {
  let depth = 0, inStr = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i], p = code[i - 1];
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && code[i + 1] === '/') { i = code.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && code[i + 1] === '*') { i = code.indexOf('*/', i); if (i < 0) return -1; i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return i; }
  }
  return -1;
}

function fnsIn(code, base) {
  const out = [];
  const pats = [
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
    /exports\.([A-Za-z_$][\w$]*)\s*=/g
  ];
  pats.forEach((re, patIdx) => {
    let m;
    while ((m = re.exec(code))) {
      /* ⚠ THE BODY BRACE, NOT THE FIRST BRACE — and getting this wrong produced a FALSE
         RED, which is the exact failure this whole tool exists to prevent. Cloud
         Functions are declared `exports.portalRsvp = onCall({ cors: true }, async
         (request) => { … })`. Taking the first `{` after the name matches the OPTIONS
         OBJECT, so the function's range came back about sixteen characters long, every
         write inside the real body fell outside it, and the engine reported a declared
         connection as broken on code that was perfectly correct.
         For the `exports.` form, skip to the `=> {` or `function (…) {` that actually
         opens the body. */
      let open;
      if (patIdx === 3) {
        const body = /=>\s*\{|function\s*\([^)]*\)\s*\{/g;
        body.lastIndex = m.index + m[0].length;
        const b = body.exec(code);
        if (!b) continue;
        open = b.index + b[0].length - 1;
      } else {
        /* ⚠ PAST THE PARAMETER LIST, NOT THE FIRST BRACE — and this was a real bug that
           produced a real false red. `async function recordPaypalPayment(phone, {
           captureId, tip, serviceAmount })` has its first `{` in the PARAMETERS, so
           taking it matched the destructure and the "function" came back as a
           zero-length range. Every declared connection inside such a function then
           reported as missing on code that was perfectly correct — and it fails silently
           in the other direction too, since a zero-length range can never contain
           anything. Walk the parameter parens to their close first. */
        let p = code.indexOf('(', m.index);
        if (p < 0) continue;
        let depth = 0, q = p;
        for (; q < code.length; q++) {
          if (code[q] === '(') depth++;
          else if (code[q] === ')') { depth--; if (!depth) break; }
        }
        open = code.indexOf('{', q);
      }
      if (open < 0) continue;
      const end = matchBrace(code, open);
      if (end > 0) out.push({ name: m[1], start: base + m.index, end: base + end });
    }
  });
  return out;
}

function index(pathOrSrc, isSource) {
  const src = isSource ? pathOrSrc : fs.readFileSync(pathOrSrc, 'utf8');
  let fns = [];
  scripts(src).forEach(s => { fns = fns.concat(fnsIn(s.code, s.off)); });
  /* Smallest-first at the same start, so a nested function wins over its parent. */
  fns.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  return { src, fns, blanked: blankNonCode(src) };
}

/* ---------------------------------------------------------------------------
 * ⭐ THE COMMENT MASK — the single most important thing in this directory.
 *
 * A map that goes green because a COMMENT still names the field is worse than no map:
 * it reports a connection as present while the code that made it is gone, and it does
 * so with authority. That is the failure this whole tool exists to catch, reproduced
 * inside the tool itself. It was demonstrated, not assumed — deleting a real writer and
 * leaving `/* needsLightBuild: true *​/` behind reported GREEN before this existed.
 *
 * ⚠ IT BLANKS, IT DOES NOT STRIP. run-all.js's stripComments REMOVES the text, which
 * shifts every offset after it — and this module's whole job is to compare positions
 * against declared anchor ranges. Replacing each comment character with a space keeps
 * the file exactly the same length, so an offset into the blanked source is the same
 * offset into the real one. That is why this is not simply a call to that helper.
 *
 * ⚠ STRING LITERALS ARE DELIBERATELY LEFT ALONE. `d['needsLightBuild']` is a genuine
 * read, and blanking strings would lose it. The cost is that a field-name list such as
 * PORTAL_READ_FIELDS registers as a touch; that is amber noise, which is visible and
 * survivable, where a missed read would be a silent false green.
 * ------------------------------------------------------------------------- */
/* The lookup tables that map a field name to words for a person. They contain no writes
   of anything — see the note at the end of blankNonCode. */
const DECLARATION_TABLES = ['CUSTOMER_FIELD_LABELS', 'CUSTOMER_FIELD_QUIET'];

function blankNonCode(src) {
  const out = src.split('');
  let i = 0, inStr = null;
  /* ⚠ QUOTES ONLY COUNT INSIDE A <script> (fixed 2026-08-28). This scanner ran over the
     WHOLE file, and admin.html is HTML: ordinary page prose is full of apostrophes —
     "don't", "Addie's", "won't" — each of which opened a string that stayed open until
     the next one. While it thought it was inside a string it stopped recognising `/*`,
     so every comment after an odd apostrophe went UNMASKED.
     ⚠ THAT IS EXACTLY THE FAILURE THIS FUNCTION EXISTS TO PREVENT, in the function
     itself. Its own header calls the comment mask "the single most important thing in
     this directory", because a map that goes green on the strength of a COMMENT reports
     a connection as present while the code that made it is gone. Found when a census of
     the places that queue a warehouse build matched a sentence inside a comment quoting
     Addie — the comment was describing the very field being counted.
     ⚠ OFFSETS ARE UNTOUCHED: this only decides WHERE quote characters are meaningful,
     and the function still returns a string of exactly the same length. */
  const inScript = (function () {
    const ranges = [];
    const re = /<script\b[^>]*>/gi;
    let m;
    while ((m = re.exec(src))) {
      const end = src.toLowerCase().indexOf('</script', m.index + m[0].length);
      ranges.push([m.index + m[0].length, end < 0 ? src.length : end]);
    }
    /* A plain .js file has no script tags and is code from end to end. */
    if (!ranges.length) return () => true;
    return pos => ranges.some(r => pos >= r[0] && pos < r[1]);
  })();
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; i++; continue; }
    if ((c === '"' || c === "'" || c === '`') && inScript(i)) { inStr = c; i++; continue; }
    if (c === '/' && n === '/') {
      const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e;
      blank(i, end); i = end; continue;
    }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i); const end = e < 0 ? src.length : e + 2;
      blank(i, end); i = end; continue;
    }
    i++;
  }
  /* ⭐ A LOOKUP TABLE IS DATA, NOT A WRITE (added 2026-08-29). The change log declares a
     human label for every editable field — `housePrice: {label: 'House price', ...}`,
     `customerNumber: 'Customer number'` — and to a scanner that reads `name:` as a write
     those ten rows are ten new places that set ten WATCHED fields. Nothing went red; the
     page simply grew ten amber rows that were never writes at all, which is amber that
     teaches you to stop reading amber.
     ⚠ NAMED, NOT INFERRED. A rule like "a value that opens a brace is not a write" would
     catch the object form and miss `customerNumber: 'Customer number'` entirely, and any
     rule loose enough to catch both would start hiding real writes. Naming the two tables
     says what is true — these hold labels, not values — and a table added later has to be
     named here deliberately.
     ⚠ BLANKED, NOT DELETED, exactly like a comment: every offset still lines up with the
     real file, so a position taken from the blanked source still points at the right
     place in admin.html. */
  DECLARATION_TABLES.forEach(function (name) {
    const at = src.indexOf('const ' + name + ' = {');
    if (at < 0) return;
    let k = src.indexOf('{', at), depth = 0, end = k;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (!depth) break; }
    }
    blank(at, end + 1);
  });
  return out.join('');
}

function enclosing(ix, pos) {
  let best = null;
  for (const f of ix.fns) {
    if (f.start <= pos && pos <= f.end) {
      if (!best || (f.end - f.start) < (best.end - best.start)) best = f;
    }
  }
  if (best) return best.name;

  /* ⭐ AN ANONYMOUS HANDLER STILL HAS A NAME — the element it is wired to.
   *
   * A great deal of this codebase lives in `getElementById('x').addEventListener(...)`,
   * which has no function name, so every touch inside one came back as "(a handler)".
   * On the money spines that was the single largest group in amber — eleven touches of
   * changeFees, all reported as the same nameless thing. A row nobody can act on is the
   * amber equivalent of noise, and the brief is explicit that amber which stops being
   * read stops being worth having.
   *
   * ⚠ IT IS CHECKED, NOT GUESSED — and the first version was guessed, which is why this
   * paragraph exists. Taking the nearest wiring line above the position named
   * `allCustExportBtn` correctly and `addBudgetCatBtn` wrongly, because a budget button
   * happened to be the closest thing above an unrelated export block. A confidently
   * wrong name is worse than no name: "(a handler)" sends somebody looking, whereas
   * "addBudgetCatBtn handler" sends them to the wrong place and wastes the trip.
   *
   * So the candidate handler's END is computed with sectionFrom — every top-level
   * construct in these files closes with `}`/`});` at column zero — and the name is
   * only claimed when the position really falls inside it. Anything else stays
   * anonymous, which is honest. */
  const src = ix.blanked;
  const re = /(?:getElementById|querySelector)\(\s*['"]#?([A-Za-z_$][\w$-]*)['"]\s*\)[^;\n]{0,80}addEventListener/g;
  let m, found = null;
  while ((m = re.exec(src)) && m.index < pos) {
    if (sectionFrom(src, m.index) >= pos) found = m[1];
  }
  return found ? found + ' handler' : null;
}

/* ---------------------------------------------------------------------------
 * sectionFrom — clip to the end of the enclosing top-level construct.
 *
 * Ported from run-all.js, where it replaced a family of fixed-length extraction windows
 * that CLAUDE.md §7 bans by name. Every top-level construct in these three files ends
 * with `}`, `});` or `})` at column zero, which is a real structural anchor that does
 * not move when a body grows.
 *
 * ⚠ THE META-CHECK THAT ENFORCES THAT BAN READS ONLY run-all.js. So nothing but this
 * comment stops a `span || 3000` reappearing here — and the first draft of this engine
 * had exactly that, which is why the note is written down rather than assumed.
 *
 * ⚠ CRLF: admin.html is CRLF, so a literal '\n});' never matches. Matched with \r?\n.
 * ------------------------------------------------------------------------- */
function sectionFrom(src, start) {
  if (start == null || start < 0) return src.length;
  const after = src.indexOf('\n', start);
  if (after === -1) return src.length;
  const re = /\r?\n\}\)*;?\r?\n/g;
  re.lastIndex = after;
  const m = re.exec(src);
  return m ? m.index + m[0].length : src.length;
}

module.exports = { index, enclosing, sectionFrom, blankNonCode };
