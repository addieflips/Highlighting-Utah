/*
 * Quote card render tests — Highlighting Utah
 *
 * Extracts renderQuoteRows() straight out of admin.html and runs it against
 * fake quote data, so a broken card is caught before it ever reaches Firebase.
 *
 * Setup (once):   npm install jsdom
 * Run:            node tests/quote-card.test.js
 *
 * Exits 0 if everything passes, 1 if anything fails.
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ADMIN = path.join(__dirname, '..', 'admin.html');

// ---- pull the functions out of admin.html -------------------------------
const html = fs.readFileSync(ADMIN, 'utf8');
const start = html.indexOf('function quoteDetailSelect(');
const endMark = '  list.innerHTML = html;';
const end = html.indexOf(endMark, start) + endMark.length;
if (start === -1 || end < start) {
  console.error('Could not find renderQuoteRows in admin.html — did it get renamed?');
  process.exit(1);
}
const source = html.slice(start, end) + '\n}\n';

const dom = new JSDOM('<div id="quotesList"></div>');
global.document = dom.window.document;

// ---- stubs for helpers renderQuoteRows leans on -------------------------
global.esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
global.fmtDate = () => 'Aug 3';
global.fmtMoney = n => '$' + Number(n).toFixed(2);
global.daysSince = () => 3;
global.isStaleUnresponsive = () => false;
global.trashIcon = () => '<svg></svg>';
global.perFootRate = 2.5;

eval(source);

const ts = d => ({ toDate: () => d });

const quotes = [
  { id: 'q1', data: {
      name: 'Dana Whitmore', phone: '(801) 555-0148', email: 'dana@x.com',
      address: '842 N Canyon Rd', contactMethod: 'Text', status: 'new' } },
  { id: 'q2', data: {
      name: 'Marcus Bell', phone: '(801) 555-0192', email: 'm@x.com',
      address: '1207 W Elk Ridge Dr', contactMethod: 'Phone', status: 'contacted',
      formCompletedAt: ts(new Date('2026-07-29')),
      lightColors: ['Warm White', 'Red'],
      houseAreas: ['Front of House', 'Right Side'],
      installPreference: 'October', wireColor: 'Green', outletTimer: 'Yes',
      specificOutlet: 'Yes', specificOutletNotes: 'back patio', gateCode: '4417',
      notes: 'Steep pitch over entry', wantsMailedInvoice: true,
      estimatedFeet: 140, quotedPrice: 490, quoteToken: 'qt_abc',
      approvalStatus: 'pending' } },
  { id: 'q3', data: {
      name: 'Quinn "Q" O\'Hara & Sons <script>', phone: 'x', email: 'e@x.com',
      address: '9 Test <b>St</b>', contactMethod: 'Email', status: 'new',
      lightColors: ['Multi'], gateCode: 'a"b', notes: 'line1\nline2' } }
];

renderQuoteRows(quotes);

const list = document.getElementById('quotesList');
const cards = list.querySelectorAll('.row-item');
const det = c => c.querySelectorAll('details')[0];
const pri = c => c.querySelectorAll('details')[1];

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('\n--- structure ---');
check('one card per quote', cards.length === 3, 'got ' + cards.length);

const [c1, c2, c3] = cards;

console.log('\n--- new lead, no detail form ---');
check('two collapsible sections', c1.querySelectorAll('details').length === 2);
check('detail form closed', !det(c1).hasAttribute('open'));
check('pricing closed', !pri(c1).hasAttribute('open'));
check('reads not returned yet', det(c1).querySelector('summary').textContent.includes('not returned yet'));
check('reads not priced yet', pri(c1).querySelector('summary').textContent.includes('not priced yet'));
check('pricing inputs nested inside closed section', pri(c1).querySelector('.quotePriceInput') !== null);
check('convert to customer present', c1.querySelector('[data-converttocust]') !== null);
check('shows Add Photo not Replace', c1.textContent.includes('Add Photo'));
check('no approval buttons when unpriced', c1.querySelector('[data-markapproval]') === null);

console.log('\n--- detail form completed ---');
check('detail form open', det(c2).hasAttribute('open'));
check('pricing still closed', !pri(c2).hasAttribute('open'));
check('summary shows completed date', det(c2).querySelector('summary').textContent.includes('completed'));
check('pricing summary shows price', pri(c2).querySelector('summary').textContent.includes('$490.00'));
check('pricing summary shows awaiting', pri(c2).querySelector('summary').textContent.includes('awaiting response'));
check('colors joined', c2.querySelector('.qdLightColors').value === 'Warm White, Red');
check('areas joined', c2.querySelector('.qdAreas').value === 'Front of House, Right Side');
check('install timing preselected', c2.querySelector('.qdInstallPref').value === 'October');
check('wire color preselected', c2.querySelector('.qdWireColor').value === 'Green');
check('outlet timer preselected', c2.querySelector('.qdOutletTimer').value === 'Yes');
check('specific outlet preselected', c2.querySelector('.qdSpecificOutlet').value === 'Yes');
check('outlet notes populated', c2.querySelector('.qdSpecificOutletNotes').value === 'back patio');
check('gate code populated', c2.querySelector('.qdGateCode').value === '4417');
check('notes populated', c2.querySelector('.qdNotes').value === 'Steep pitch over entry');
check('mailed invoice checked', c2.querySelector('.qdWantsMailed').checked === true);
check('save details button present', c2.querySelector('[data-savequotedetail]') !== null);
check('both approval buttons present', c2.querySelectorAll('[data-markapproval]').length === 2);
check('approval link shown', c2.querySelector('.quotelink-box').textContent.includes('qt_abc'));
check('copy quote email present', c2.querySelector('[data-copyquoteemail]') !== null);
check('estimated price line shown', c2.textContent.includes('Estimated Price'));

console.log('\n--- escaping / hostile input ---');
check('no script tag injected', c3.querySelector('script') === null);
check('name escaped, still readable', c3.textContent.includes('Quinn "Q" O\'Hara & Sons'));
check('address not parsed as markup', c3.querySelector('.address-link-btn b') === null);
check('quote mark survives into input', c3.querySelector('.qdGateCode').value === 'a"b');
check('newline preserved in notes', c3.querySelector('.qdNotes').value.includes('\n'));

console.log('\n--- empty and missing fields ---');
check('empty areas render blank', c3.querySelector('.qdAreas').value === '');
check('missing install pref falls back to blank', c3.querySelector('.qdInstallPref').value === '');
check('missing wire color falls back to blank', c3.querySelector('.qdWireColor').value === '');
check('mailed invoice unchecked', c3.querySelector('.qdWantsMailed').checked === false);

console.log('\n--- ids and wiring ---');
const allIds = [...list.querySelectorAll('[id]')].map(e => e.id);
check('no duplicate ids', new Set(allIds).size === allIds.length);
const dataIds = [...list.querySelectorAll('.qdGateCode')].map(e => e.dataset.id);
check('each card wired to its own quote', new Set(dataIds).size === 3);

console.log('\n--- comma parsing (mirrors the save handler) ---');
const csv = v => v.split(',').map(s => s.trim()).filter(Boolean);
[['Warm White, Red, Red', ['Warm White', 'Red', 'Red']],
 ['Red,Green', ['Red', 'Green']],
 ['  Red ,  Green  ', ['Red', 'Green']],
 ['Red,,Green', ['Red', 'Green']],
 ['Red,', ['Red']],
 ['', []], ['   ', []], [',,,', []]
].forEach(([input, expected]) => {
  check('parses ' + JSON.stringify(input),
    JSON.stringify(csv(input)) === JSON.stringify(expected),
    JSON.stringify(csv(input)));
});
['Warm White, Red, Red', 'Red,,Green', '  Red , Green '].forEach(input => {
  const once = csv(input);
  check('round trip stable: ' + JSON.stringify(input),
    JSON.stringify(once) === JSON.stringify(csv(once.join(', '))));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
