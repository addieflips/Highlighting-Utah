/* WHERE THINGS GO — the grid's data.
 * ==================================
 * Addie's mockup (connections-one-tab.html): fields down the side in the words on the
 * form, the record each is stored on, and every place it lands across the top. A filled
 * square writes, an outlined one reads, red is declared-but-missing, amber is
 * found-but-never-declared.
 *
 * ⚠ THIS SHAPES, IT DOES NOT DECIDE. Every red and every amber comes from engine.js
 * running against the real files. Nothing here can turn a square green.
 */
'use strict';

/* ⭐ THE EIGHT COLUMNS ARE HERS, and the mapping to our own `where` strings is written
   out rather than guessed, because a `where` that falls through would silently lose a
   connection off the right-hand side of the grid — a square that is absent and a square
   that is empty look identical.
   ⚠ EVERY `where` MUST LAND SOMEWHERE. `unmapped()` below reports any that do not, and
   the gate fails on it: a destination nobody drew is exactly the invisible hole this
   whole page exists to make visible. */
const DEST = ['Customers', 'Warehouse', 'Routes', 'Schedule', 'Invoices', 'Print Today', 'Portal', '7pm run'];

const WHERE_TO_DEST = {
  'Customers › Add a Customer':   'Customers',
  'Customers › All Customers':    'Customers',
  'Customers › Bulk Updates':     'Customers',
  'Customers › Who Pays for Whom':'Customers',
  'Customer Numbers':             'Warehouse',
  'Warehouse › Build':            'Warehouse',
  'Warehouse › Recycle':          'Warehouse',
  'Warehouse › Tools':            'Warehouse',
  'Routes › Install':             'Routes',
  'Routes › Map View':            'Routes',
  'Schedule › Scheduling':        'Schedule',
  'Schedule › Printing':          'Print Today',
  'Invoices › Invoice List':      'Invoices',
  'Invoices › Import / Export':   'Invoices',
  'Invoices › Nightly Automation':'7pm run',
  'Member Portal › RSVP':         'Portal',
  'Member Portal › My Lights':    'Portal',
  'Member Portal › Pay':          'Portal',
  /* ⛔ ADDED 2026-09-03 (RS-51). The Cancel tab became a destination in its own
     right the day it stopped sharing a rule with RSVP: it is now the ONLY door a
     customer has to a recycle, where answering no used to be a second one. */
  'Member Portal › Cancel':       'Portal',
  'Quote Requests':               'Customers',
  /* ⚠ AUTOMATION EMAILS HAS NO COLUMN IN THE MOCKUP, and it is folded here rather than
     dropped. Say so if it ever carries a connection the office needs to see on its own —
     silently merging a destination is the same failure as silently losing one. */
  'Automation Emails › Recipients': 'Portal'
};

function unmapped(manifest) {
  const out = [];
  manifest.forEach(s => (s.sets || []).concat(s.reads || []).forEach(c => {
    if (!WHERE_TO_DEST[c.where] && out.indexOf(c.where) === -1) out.push(c.where);
  }));
  return out;
}

/* One grid per area. A field appears on every area it belongs to — Light colours is a
   quote answer, a customer field AND a warehouse input, and hiding it from two of the
   three would be the picture lying by omission. */
function build(report, manifest) {
  const byField = {};
  report.forEach(r => { byField[r.spine.field] = r; });
  const areas = {};

  manifest.forEach(spine => {
    const r = byField[spine.field];
    if (!r) return;
    (spine.areas || []).forEach(area => {
      areas[area] = areas[area] || { rows: [] };
      const cells = {};
      /* ⚠ A BROKEN CONNECTION OUTRANKS A WORKING ONE IN THE SAME SQUARE. One place can
         both write and read a field; if the write is missing, the square must be RED
         rather than quietly showing the read that still works. */
      const rank = { bad: 4, wrn: 3, set: 2, read: 1 };
      r.rows.forEach(row => {
        const d = WHERE_TO_DEST[row.where];
        if (!d) return;
        const state = !row.found ? 'bad' : (row.side === 'sets' ? 'set' : 'read');
        if (!cells[d] || rank[state] > rank[cells[d].state]) {
          cells[d] = { state: state, where: row.where, why: row.why || '', anchor: row.anchor, rules: row.rules || [] };
        }
      });
      areas[area].rows.push({
        field: spine.field,
        title: spine.title,
        plain: spine.plain,
        record: spine.record,
        guard: spine.guard || null,
        states: spine.states || [],
        cells: cells
      });
    });
  });

  Object.keys(areas).forEach(a => areas[a].rows.sort((x, y) => x.title.localeCompare(y.title)));
  return { DEST: DEST, areas: areas, unmapped: unmapped(manifest) };
}

module.exports = { build, DEST, WHERE_TO_DEST, unmapped };
