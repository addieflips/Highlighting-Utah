/* RULES — Addie's own rulings, rendered as cards you can read down.
 * ================================================================
 * The second half of her mockup: "a card per area, opening into blocks... each holding a
 * few short rules. Every block can be confirmed or flagged by a person."
 *
 * ⭐ THE CONTENT IS NOT AUTHORED HERE, AND THAT IS THE WHOLE POINT. The brief is explicit:
 * "Humans write rulings; behaviour is derived." Writing the code's behaviour out as prose
 * would be a second copy of the codebase, stale in weeks. So every block on this page is
 * a row of `claude/questions-map.md` — a judgement SHE made — and nothing else appears.
 *
 * ⚠ ONE SOURCE, NOT A COPY. This parses the map at build time; it never stores its own
 * version of a ruling. A ruling edited in the map is edited here on the next build, and
 * there is no second place for the two to disagree.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Her prefixes, in her words. ⚠ AN UNKNOWN PREFIX IS REPORTED, NEVER DROPPED — a whole
   family of rulings silently missing from the page would be the page lying by omission,
   which is the failure the map itself exists to prevent. */
const AREAS = {
  MON: 'Money', QT: 'Quotes', WH: 'Warehouse', SCH: 'Schedule',
  RS: 'RSVP and the season', SH: 'The master sheet', PROC: 'How we work',
  CN: 'Customer numbers', DUP: 'Duplicates', MSG: 'Messages',
  PR: 'Printing', HC: 'Health Check', FIX: 'Fixes', OPT: 'Options',
  MR: 'Measure Roof'
};

/* The map's own Status column is the honest starting state. A person confirming a block
   is a separate, later fact — it is never inferred from the map. */
const STATE = {
  'Standing': 'new',
  'Superseded': 'lapsed',
  'Closed': 'ok',
  'Decided — not built': 'unbuilt'
};

/* A ruling's answer is one long cell. Split it where SHE puts a break: the ⚠ and ⭐
   markers are the sentences that matter, and the leading text is the ruling itself. */
function toLines(answer) {
  const parts = String(answer).split(/(?=[⚠⭐])/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts : [String(answer).trim()];
}

function parse(mapPath) {
  const p = mapPath || path.join(__dirname, '..', 'claude', 'questions-map.md');
  if (!fs.existsSync(p)) return { areas: {}, total: 0, unknown: [], missing: true };
  const areas = {}, unknown = [];
  let total = 0;
  fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
    const m = /^\|\s*([A-Z]+)-(\d+[a-z]?)\s*\|/.exec(line);
    if (!m) return;
    const cols = line.split('|').map(c => c.trim());
    if (cols.length < 7) return;
    const id = cols[1], question = cols[2], answer = cols[3];
    const when = cols[4], proof = cols[5], status = cols[6];
    const area = AREAS[m[1]];
    if (!area) { if (unknown.indexOf(m[1]) === -1) unknown.push(m[1]); return; }
    total++;
    areas[area] = areas[area] || { blocks: [] };
    areas[area].blocks.push({
      id: id,
      name: question,
      lines: toLines(answer),
      when: when,
      /* ⚠ "not checkable" IS A REAL CATEGORY AND IT IS DERIVED, NOT GUESSED. A row whose
         proof column names no code is a claim rather than a proof — the map's own gate
         already reports those, and the card should say so where somebody is deciding
         what to read first. */
      proof: /`/.test(proof) ? 'code' : 'words',
      state: STATE[status] || 'new'
    });
  });
  return { areas: areas, total: total, unknown: unknown, missing: false };
}

module.exports = { parse, AREAS, STATE };
