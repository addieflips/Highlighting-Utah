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
        open = code.indexOf('{', m.index + m[0].length - 1);
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
function blankNonCode(src) {
  const out = src.split('');
  let i = 0, inStr = null;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) { if (c === inStr && src[i - 1] !== '\\') inStr = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; i++; continue; }
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
  return out.join('');
}

function enclosing(ix, pos) {
  let best = null;
  for (const f of ix.fns) {
    if (f.start <= pos && pos <= f.end) {
      if (!best || (f.end - f.start) < (best.end - best.start)) best = f;
    }
  }
  return best ? best.name : null;
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
