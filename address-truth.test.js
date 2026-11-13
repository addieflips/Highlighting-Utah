/*
 * ONE ADDRESS, READ ONE WAY — [[SCH-156]], 2026-11-13
 *
 * Owner: "a prblem weve been having lately is when people move or something it uses their old address
 * rather than their new one for some reason can you figure that out and make sure it doesnt happen again."
 *
 * ⛔ A CUSTOMER RECORD HOLDS ITS STREET TWICE. The importers write `street` (and `zip`) AND `address`, the
 * line built from them; the office edits only `address`. [[SCH-155]] made the printed sheets read the
 * address line first (`custStreetOf`) and made Edit Customer rewrite `street` on a move — but some twenty
 * other readers still took `street` first: the website → master-sheet row, the sheet-vs-site comparison,
 * the duplicate finder, Customer Numbers matching, the Bulk Update matcher, several "where" labels. A record
 * moved before 6 November (or by any path that wrote only the line) showed the old house in every one of
 * them — and the master-sheet row wrote the OLD street into the workbook, from where the next import could
 * write it back over the move.
 *
 * What this gate holds, RUN rather than matched wherever it can be:
 *   1. custStreetOf / custZipOf / custAddressHeal give the house they live at now.
 *   2. The website → sheet row carries the new street and never the old zip.
 *   3. No reader in admin.html prefers a record's `street` over its address line (a census with a named
 *      allow-list — a new `.street ||` read fails until somebody decides which side it belongs on).
 *   4. Edit Customer heals a stale record on any save; a street taken from the sheet moves the line too.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}

/* \r?\n so a CRLF checkout lifts the same bodies (CLAUDE.md §7). */
function fn(name) {
  const at = admin.indexOf('\nfunction ' + name + '(');
  if (at === -1) return '';
  const m = /\r?\n\}/.exec(admin.slice(at + 1));
  return m ? admin.slice(at + 1, at + 1 + m.index + m[0].length) : '';
}
/* Lift a set of functions and any helper they turn out to call, never a stub. */
function sandbox(names, ret, probe) {
  const lifted = new Set(names);
  let code = names.map(fn).join('\n');
  for (let tries = 0; tries < 40; tries++) {
    /* A missing helper only shows when the lifted code RUNS, so the probe runs inside the loop. */
    try { const out = new Function(code + '\nreturn ' + ret + ';')(); return probe ? probe(out) : out; }
    catch (e) {
      const m = /^(\w+) is not defined/.exec(e.message);
      if (!m || lifted.has(m[1]) || !fn(m[1])) throw e;
      code = fn(m[1]) + '\n' + code; lifted.add(m[1]);
    }
  }
  throw new Error('could not lift ' + names.join(', '));
}

/* A customer who moved before SCH-155: the office typed the new line, nothing rewrote the split fields. */
const MOVED = { name: 'Test Mover', address: '123 N Newhouse Ln, Highland, UT 84111',
                street: '45 Oldhouse Ct', city: 'Highland', zip: '84999', customerNumber: '9001' };
/* Moved, and the new line carries no zip. */
const MOVED_NOZIP = { address: '123 N Newhouse Ln, Highland, UT', street: '45 Oldhouse Ct', zip: '84999' };
/* Never moved — the importer's own shape. */
const STILL = { address: '209 S 850 W, Lehi, UT 84043', street: '209 S 850 W', zip: '84043', city: 'Lehi' };

console.log('\n1. The house they live at now');
const h = sandbox(['custStreetOf', 'custZipOf', 'custAddressHeal', 'normalizeStreetForMatch'],
                  '{streetOf: custStreetOf, zipOf: custZipOf, heal: custAddressHeal}');
check('street of a moved record is the new house', h.streetOf(MOVED) === '123 N Newhouse Ln', h.streetOf(MOVED));
check('zip of a moved record is the line\'s own zip', h.zipOf(MOVED) === '84111', h.zipOf(MOVED));
check('a moved line with no zip never inherits the old house\'s zip', h.zipOf(MOVED_NOZIP) === '', h.zipOf(MOVED_NOZIP));
check('an unmoved record keeps its zip', h.zipOf(STILL) === '84043');
check('an unmoved line without a zip keeps the stored one',
  h.zipOf({ address: '209 S 850 W, Lehi, UT', street: '209 S 850 W', zip: '84043' }) === '84043');
check('a record with no address line falls back to its street', h.streetOf({ street: '1 Main St' }) === '1 Main St');
const healed = h.heal(MOVED);
check('the heal rewrites street and zip of a moved record',
  healed.street === '123 N Newhouse Ln' && healed.zip === '84111', JSON.stringify(healed));
check('the heal writes nothing to a record that agrees with itself', Object.keys(h.heal(STILL)).length === 0,
  JSON.stringify(h.heal(STILL)));
check('the heal writes nothing when there is no address line', Object.keys(h.heal({ street: '1 Main St', zip: '1' })).length === 0);

console.log('\n2. What goes to the master sheet');
let row = null;
try { row = sandbox(['rbCustomerToSheetRow'], 'rbCustomerToSheetRow', f => f(MOVED)); }
catch (e) { check('rbCustomerToSheetRow runs', false, e.message); }
if (row) {
  check('the sheet row carries the new street', row.indexOf('123 N Newhouse Ln') !== -1, JSON.stringify(row.slice(0, 6)));
  check('the sheet row never carries the old street', row.indexOf('45 Oldhouse Ct') === -1);
  check('the sheet row carries the new zip, not the old one', row.indexOf('84111') !== -1 && row.indexOf('84999') === -1);
}

console.log('\n3. Nobody reads `street` ahead of the address line');
/* Every `X.street ||` in admin.html, comments stripped. Allowed: an address-first read (`.address || X.street`),
   the three helpers that ARE the rule, and the named reads of things that are not a customer record. */
const code = admin.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const ALLOWED = [
  /* the rule itself */
  "return first || String(d.street || '').trim();",
  "=== normalizeStreetForMatch(String(d.street || '')) ? stored : '';",
  "if(st && st !== String(d.street || '').trim()) out.street = st;",
  /* a pending sheet update (`u`) and a pasted sheet row (`r`), not a stored record */
  "const st = 'street' in u ? String(u.street || '').trim() : custStreetOf(cur);",
  "street: r.street || r.name});",
  /* a QUOTE filling the Add Customer form — quotes keep street and line together */
  "document.getElementById('routeStreetInput').value = d.street || '';",
  /* search: matching the old street as well only ever FINDS somebody, it never places them */
  "(a.data.street||'').toLowerCase().indexOf(t) !== -1",
];
const lines = code.split(/\r?\n/);
const reads = [];
lines.forEach((ln, i) => {
  if (!/\.street\s*\|\|/.test(ln)) return;
  if (/\.address\s*\|\|\s*\w+(?:\.\w+)*\.street\s*\|\|/.test(ln)) return; // address first
  if (ALLOWED.some(a => ln.indexOf(a) !== -1)) return;
  reads.push((i + 1) + ': ' + ln.trim().slice(0, 140));
});
check('no reader prefers a stale `street` (' + reads.length + ' found)', reads.length === 0, reads.join('\n        '));
const allowHits = ALLOWED.map(a => lines.filter(ln => ln.indexOf(a) !== -1).length);
check('every allow-list entry still names a real line', allowHits.every(n => n > 0),
  ALLOWED.filter((a, k) => !allowHits[k]).join(' | '));
/* The `where` labels and matchers that used to be stale-first, by name. */
['function dupStreetOf(d){ return normalizeStreetForMatch(custStreetOf(d)); }',
 "return normalizeStreetForMatch(custStreetOf(it.data));",
 "const existingStreet = normalizeStreetForMatch(custStreetOf(item.data));",
 "const onFileStreet = existing ? custStreetOf(existing.data) : '';",
 "Street: custStreetOf(d), City: d.city || '', State: d.state || '', ZIP: custZipOf(d),",
].forEach(s => check('reads through the rule: ' + s.slice(0, 60), code.indexOf(s) !== -1));
/* Bare `String(d.street || '')` reads were the other spelling of the same fault. */
const bare = lines.filter(ln => /const street = String\(\w+\.street \|\| ''\)\.trim\(\);/.test(ln));
check('no bare `const street = String(x.street ...)` read is left', bare.length === 0, bare.join(' | '));

console.log('\n4. The writers keep the two copies in step');
const sheetCompare = (code.match(/const mine = f\.key[^;]*;/) || [''])[0];
check('the sheet-vs-site comparison reads the street through the rule', /custStreetOf\(d\)/.test(sheetCompare), sheetCompare);
check('…and the zip', /custZipOf\(d\)/.test(sheetCompare), sheetCompare);

/* Edit Customer: an address line that did not change still heals the split fields. RUN the branch. */
const editAt = code.indexOf('if(newAddress && newAddress !== oldAddress){');
const editEnd = editAt === -1 ? -1 : code.indexOf('const existingNum = String(item.data.customerNumber', editAt);
const editSrc = editAt === -1 || editEnd === -1 ? '' : code.slice(editAt, editEnd);
check('Edit Customer\'s address branch was found', editSrc.length > 100);
try {
  const run = new Function('h', 'item', 'newAddress', 'oldAddress',
    'const custAddressHeal = h.heal; const addrUpdates = {}; let geocodeFailed = false;' +
    'const statusEl = {}; const geocodeAddress = async () => ({lat: 1, lng: 2});' +
    'return (async () => { ' + editSrc + ' return addrUpdates; })();');
  run(h, { data: MOVED }, MOVED.address, MOVED.address).then(u => {
    check('an ordinary save of a moved record heals its street and zip',
      u.street === '123 N Newhouse Ln' && u.zip === '84111', JSON.stringify(u));
    return run(h, { data: STILL }, STILL.address, STILL.address);
  }).then(u => {
    check('an ordinary save of a sound record writes no address field', !('street' in u) && !('zip' in u), JSON.stringify(u));
    finish();
  }).catch(e => { check('Edit Customer branch runs', false, e.message); finish(); });
} catch (e) { check('Edit Customer branch compiles', false, e.message); finish(); }

/* The sheet sync: a street taken from the sheet rebuilds the line and the pin. RUN the block. */
function sheetSyncChecks() {
  const at = code.indexOf("if(!('street' in u) && !('city' in u) && !('zip' in u)) continue;");
  const start = at === -1 ? -1 : code.lastIndexOf('for(const cid of Object.keys(byCust)){', at);
  const end = start === -1 ? -1 : code.indexOf('const ids = Object.keys(byCust);', start);
  const src = start === -1 || end === -1 ? '' : code.slice(start, end);
  check('the sheet sync\'s address block was found', src.length > 100);
  const lib = sandbox(['custStreetOf', 'custZipOf', 'normalizeStreetForMatch', 'buildFullAddress'],
                      '{custStreetOf, custZipOf, normalizeStreetForMatch, buildFullAddress}');
  const run = new Function('lib', 'byCust', 'jobAddresses',
    'const {custStreetOf, custZipOf, buildFullAddress} = lib; const extractCleanCity = s => String(s||"").trim();' +
    'const geocodeAddress = async () => ({lat: 40.1, lng: -111.8});' +
    'return (async () => { ' + src + ' return byCust; })();');
  const byCust = { a: { street: '1 New Rd' }, b: { phone: '8015550000' } };
  const recs = [{ id: 'a', data: { address: '5 Old Ln, Lehi, UT 84043', street: '5 Old Ln', city: 'Lehi', zip: '84043' } },
                { id: 'b', data: STILL }];
  return run(lib, byCust, recs).then(out => {
    check('a street from the sheet rebuilds the address line', out.a.address === '1 New Rd, Lehi, UT 84043', JSON.stringify(out.a));
    check('…and re-pins the house', out.a.lat === 40.1 && out.a.lng === -111.8);
    check('a row with no address change is left alone', !('address' in out.b), JSON.stringify(out.b));
  }).catch(e => check('sheet sync block runs', false, e.message));
}

let finished = false;
function finish() {
  if (finished) return; finished = true;
  sheetSyncChecks().then(() => {
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    if (fail) { console.log('\nFAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
  });
}
