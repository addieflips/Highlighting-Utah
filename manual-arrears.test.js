/*
 * A DEBT FROM AN EARLIER SEASON, TYPED IN BY HAND
 *
 * Addie, 2026-09-01: "one at a time but only this year in the future we can
 * use carry."
 *
 * ⚠ THE GAP IS NARROW AND REAL. Start New Season carries an unpaid balance
 * forward by itself, and the Arrears Backfill repairs seasons reset before
 * 31 August — but both read a saved snapshot. A debt from a season with no
 * snapshot behind it could be recorded NOWHERE.
 *
 * ⚠ AND IT IS MONEY THAT ALSO DECIDES WHO GETS A CREW, so the shape matters as
 * much as the amount: the wrong `kind` bills them and still sends a van.
 *
 * Its own file per R-018.
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, why) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (why ? '\n        ' + why : '')); }
}
/* Slices to the matching closing brace — §7 bans fixed-length windows. */
function lift(name) {
  let i = admin.indexOf('async function ' + name + '(');
  if (i === -1) i = admin.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('cannot find ' + name);
  let depth = 0, started = false;
  for (let j = admin.indexOf('{', i); j < admin.length; j++) {
    if (admin[j] === '{') { depth++; started = true; }
    else if (admin[j] === '}') { depth--; if (started && depth === 0) return admin.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces lifting ' + name);
}
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n=== A debt typed in by hand ===\n');

// ---- the markup exists and is reachable -----------------------------------
['editCustArrearsBlock','editCustArrearsAmount','editCustArrearsYear',
 'editCustArrearsSaveBtn','editCustArrearsClearBtn','editCustArrearsCurrent',
 'editCustArrearsStatus'].forEach(id => {
  check(id + ' exists in the page', admin.indexOf('id="' + id + '"') !== -1,
    'a handler wired to markup that is not there is a button nobody can press');
});

const write = strip(lift('editCustArrearsWrite'));

/* ⭐ THE KIND IS THE WHOLE THING. Without ARREARS_KIND this reads as a
   light-change fee to every existing reader, owesFromLastSeason cannot find it,
   and the season hold never applies — so the customer is billed AND still sent
   a crew. That is worse than not recording the debt at all. */
check('it writes the arrears kind, not a plain fee',
  /kind:\s*ARREARS_KIND/.test(write),
  'the wrong kind bills them and still sends a van');

check('it stamps the year it was given',
  /year:\s*String\(year\)/.test(write),
  'MON-35 turns on the year being the season they fell behind');

check('the sentence names that same year',
  /'Unpaid balance carried from the ' \+ year \+ ' season'/.test(write),
  'an older note reads its year out of this sentence, so the two must agree');

/* ⚠ ONE ARREARS NOTE PER INVOICE. "Earliest year only, for the whole lump sum"
   (MON-35) falls out for free from that invariant; appending would break it
   silently — two notes, two years, and the badge shows whichever sorts first. */
check('it REPLACES any existing arrears note rather than appending',
  /filter\(function\(n\)\{ return !n \|\| n\.kind !== ARREARS_KIND; \}\)/.test(write),
  'two arrears notes on one invoice makes the year ambiguous and double-counts the debt');

check('every other fee kind survives',
  /const kept = prior\.filter/.test(write) && /const notes = kept\.slice\(\)/.test(write),
  'a light-change fee must not vanish because a debt was recorded');

/* The printed invoice sums the notes; the status pill reads changeFees. If they
   drift, the rows stop adding up to the total beside them. */
check('changeFees is re-totalled FROM the notes',
  /notes\.reduce\(/.test(write) && /changeFees: fees/.test(write),
  'the figure and the lines have to come from the same place');

check('zero removes the note instead of writing a zero line',
  /if\(amount > 0\)\{/.test(write),
  'a $0 arrears row on a customer bill is noise that still trips the hold');

check('it mirrors into the cache',
  /inv\.data\.changeFeeNotes = notes/.test(write),
  'the panel repaints from the cache, so without this the box springs back');

// ---- it must NOT be part of the ordinary save ------------------------------
/* ⚠ THE MANUAL-FEE BOX IS REBUILT ON EVERY SAVE, so a blank box removes the
   fee. Doing that here would mean an ordinary save to fix a phone number wipes
   a real debt and releases the season hold with it. */
const saveHandler = admin.slice(admin.indexOf("const newManualFee"),
                                admin.indexOf("const newManualFee") + 60000);
check('the Edit Customer save never writes the arrears note',
  !/ARREARS_KIND/.test(strip(saveHandler)),
  'an ordinary save would wipe a real debt — the 2026-08-26 colour wipe, on money');

check('the save keeps every kind except manual',
  /priorFees\.filter\(function\(f\)\{ return f\.kind !== 'manual'; \}\)/.test(admin),
  "if this ever widens, a typed-in debt stops surviving an ordinary save");

// ---- it is redrawn on every open -------------------------------------------
/* ⚠ Including a house-tab click — otherwise the box shows the PREVIOUS
   customer's debt, which is the tab-strip leak on money. */
check('openEditCustomerModal refreshes the box',
  /editCustArrearsRefresh\(\)/.test(admin.slice(admin.indexOf('function openEditCustomerModal'),
                                                admin.indexOf('function openEditCustomerModal') + 40000)),
  'without this the box shows the last customer you looked at');

const refresh = strip(lift('editCustArrearsRefresh'));
check('the box reads what is actually on the invoice',
  /arrearsOnInvoice\(inv\.data\)/.test(refresh) && /arrearsYearOnInvoice\(inv\.data\)/.test(refresh),
  'a second opinion here would disagree with the badge beside it');

check('an empty record defaults the year to LAST season',
  /getFullYear\(\) - 1/.test(refresh),
  'a debt being typed in is almost always last season; this year is the wrong guess');

/* Resolved the same way houseArrearsYear resolves, or the box and the badge
   name different invoices for a house billed elsewhere. */
const invFn = strip(lift('editCustArrearsInvoice'));
check('it resolves the invoice by billToPhone then the key',
  /billToPhone/.test(invFn) && /custInvoiceKey\(d\)/.test(invFn),
  'a house billed elsewhere must reach the payer invoice, not its own empty one');

// ---- clearing is a decision -------------------------------------------------
check('clearing asks first',
  /confirm\(/.test(admin.slice(admin.indexOf("editCustArrearsClearBtn')?.addEventListener"),
                               admin.indexOf("editCustArrearsClearBtn')?.addEventListener") + 1200)),
  'clearing says they have paid: it releases the season hold and takes the line off the bill');

check('a year is required, never guessed',
  /year >= 2000 && year <= 2100/.test(admin),
  'defaulting silently would relabel an old debt as a new one');

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) { console.log('A typed-in debt would not hold, or would not survive.\n'); process.exit(1); }
