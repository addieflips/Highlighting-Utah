/*
 * The 📱 Numbers buttons on a Schedule day — Highlighting Utah
 *
 * Dax, 2026-10-05: "i need a way to bulk text everyone on a given day, have it formatted for
 * full day, crew 1 or crew 2, and then i can go to google voice and bulk text it to them."
 *
 * Its own file per R-018. It RUNS dayPhoneList, the rule that decides who is in the list,
 * against fixtures — every claim here is about which numbers end up on somebody's clipboard,
 * which a text match cannot see. printCustData is handed in as the input it is (the customer
 * record behind a plan house); the rule itself is lifted, never re-written here.
 *
 * Run:  node day-phones.test.js      (or: npm run test:dayphones)
 */
const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) pass++; else { fail++; failures.push(label + (detail ? ' — ' + detail : '')); }
}
function fn(name) {
  const at = admin.indexOf('function ' + name + '(');
  if (at === -1) return '';
  const m = /\r?\n\}/.exec(admin.slice(at));
  return m ? admin.slice(at, at + m.index + m[0].length) : '';
}

const src = fn('dayPhoneList');
check('dayPhoneList is still in admin.html', !!src);
if (src) {
  const run = (houses, recs) => new Function('printCustData', src + 'return dayPhoneList;')(
    h => recs[h.id] || {})(houses);

  const recs = {
    a: {name: 'Ann', phone: '(801) 555-1234'},
    b: {name: 'Bob', phone: '8015551234'},          // same number as Ann, typed plain
    c: {name: 'Cal', phone: '1-801-555-9876'},      // leading 1
    d: {name: 'Dee', phone: 'n/a'},                 // words, no digits
    e: {name: 'Eve', phone: '801 555 4321', smsOptedOut: true},
    f: {name: 'Fay', phone: ''},
  };
  const r = run(['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({id})), recs);

  check('numbers are formatted (801) 555-1234', r.numbers[0] === '(801) 555-1234', JSON.stringify(r.numbers));
  check('two houses on one phone are one text, whatever the formatting', r.numbers.length === 2,
    JSON.stringify(r.numbers));
  check('a leading 1 is dropped', r.numbers.indexOf('(801) 555-9876') !== -1, JSON.stringify(r.numbers));
  check('somebody who texted STOP is left out', r.numbers.indexOf('(801) 555-4321') === -1);
  check('and named, never dropped silently', r.optedOut.join() === 'Eve', JSON.stringify(r.optedOut));
  check('no usable number is named, words or blank', r.noPhone.join() === 'Dee,Fay', JSON.stringify(r.noPhone));
  check('a plan house with no customer behind it falls back to its own phone',
    run([{id: 'z', name: 'Zed', phone: '801-555-0000'}], {}).numbers.join() === '(801) 555-0000');
  check('nothing on the day is an empty list, not a crash',
    run([], {}).numbers.length === 0 && run(undefined, {}).numbers.length === 0);
}

/* The wiring: the buttons are drawn beside the print buttons, and the click reaches the handler. */
const dayPanel = admin.slice(admin.indexOf('data-printday="'), admin.indexOf('data-printday="') + 4000);
check('a Numbers: whole day button is drawn on the day panel', /data-phones="'\+day\.id\+'" data-crew="all"/.test(dayPanel));
check('and one per crew that has houses that day', /data-phones="'\+day\.id\+'" data-crew="'\+i\+'"/.test(dayPanel)
  && /crewHousesFor\(i,day\)\.length\s*\r?\n?\s*\? '<button class="mini" data-phones=/.test(dayPanel));
check('the click handler calls showDayPhones',
  /const phonesEl=t\.dataset\.phones\?t:t\.closest\('\[data-phones\]'\);\s*\r?\n\s*if\(phonesEl\)\{showDayPhones\(/.test(admin));
const show = fn('showDayPhones');
check('the whole-day list is the day\'s houses and a crew list is that crew\'s',
  /all\?day\.houses:crewHousesFor\(Number\(crew\),day\)/.test(show));
check('the box warns that one message to many is a group text', /group text/.test(show));

console.log('\nDay phone numbers — ' + pass + ' passed, ' + fail + ' failed');
if (fail) { failures.forEach(f => console.log('  FAIL  ' + f)); process.exit(1); }
