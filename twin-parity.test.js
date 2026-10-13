#!/usr/bin/env node
/* ============================================================================
 * THE SAME RULE, WRITTEN TWICE, STILL SAYS THE SAME THING
 * `npm run test:twins` — its own file per R-018.
 *
 * connections/twins.js lists every rule the office page and the server each carry a copy
 * of. Eight had nothing running the two side by side. This file runs the pure ones over
 * the same inputs and requires the same answer — money-parity's shape, for the rules that
 * are not money.
 *
 * ⭐ ITS FIRST RUN FOUND A REAL BUG. contactIndexFields in admin.html read /D/g where the
 * server reads /\D/g — a lost backslash that stripped the LETTER D and kept every bracket,
 * space and dash. Every customer the office saved with a formatted phone got a phoneDigits
 * key like "(801) 555-0123", and the server's "is this quote from a member?" lookup — which
 * queries phoneDigits with no fallback — could not find them.
 *
 * ⛔ LIFTED, NEVER STUBBED. Each function and the helpers it calls come out of the real
 * files; a stub would decide the very answer being compared.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); return; }
  fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

/* Brace-matched lift that skips strings, comments and regex literals well enough for these
   functions — the same walk money-parity uses. */
function lift(src, name) {
  const m = new RegExp('(?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  let depth = 0, inLine = false, inBlock = false, quote = null, esc = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (esc) { esc = false; continue; }
    if (quote) { if (ch === '\\') esc = true; else if (ch === quote) quote = null; continue; }
    if (inLine) { if (ch === '\n') inLine = false; continue; }
    if (inBlock) { if (ch === '*' && nx === '/') { inBlock = false; i++; } continue; }
    if (ch === '/' && nx === '/') { inLine = true; i++; continue; }
    if (ch === '/' && nx === '*') { inBlock = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(m.index, i + 1).replace(/^export\s+/, '');
  }
  return null;
}
const constOf = (src, name) => { const m = new RegExp('const ' + name + '\\s*=\\s*[^;]+;').exec(src); return m ? m[0] : ''; };

const admin = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
const fns = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8');

/* Build a callable out of a list of lifted names. A missing name fails loudly — a test
   that cannot find its target must never report green. */
function build(src, names, extra, ret) {
  const parts = names.map(n => [n, lift(src, n)]);
  const missing = parts.filter(p => !p[1]).map(p => p[0]);
  if (missing.length) throw new Error('could not lift: ' + missing.join(', '));
  return new Function((extra || '') + '\n' + parts.map(p => p[1]).join('\n') + '\nreturn ' + ret + ';')();
}
function pair(label, makeA, makeB) {
  let a = null, b = null;
  try { a = makeA(); } catch (e) { check(label + ': the office copy can be lifted', false, e.message); }
  try { b = makeB(); } catch (e) { check(label + ': the server copy can be lifted', false, e.message); }
  return [a, b];
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

console.log('\n=== Rules written twice, run side by side ===\n');

/* ---- contactIndexFields: the sign-in and member-lookup keys ---------------- */
{
  const [o, s] = pair('contactIndexFields',
    () => build(admin, ['contactIndexFields'], '', 'contactIndexFields'),
    () => build(fns, ['digitsOnly', 'contactIndexFields'], '', 'contactIndexFields'));
  if (o && s) {
    const inputs = [
      { phone: '(801) 555-0123', email: ' Dana@X.com ', email2: 'B@Y.com' },
      { phone: '801-555-0123' }, { phone: '8015550123' }, { phone: '801.555.0123 ext D4' },
      { phone: '' }, { email: 'a@b.co' }, {}, { phone: null, email: null }
    ];
    const bad = inputs.filter(i => !same(o(Object.assign({}, i)), s(Object.assign({}, i))));
    check('contactIndexFields gives the same keys on both sides', bad.length === 0,
      bad.map(i => JSON.stringify(i) + ' → office ' + JSON.stringify(o(Object.assign({}, i))) +
        ' / server ' + JSON.stringify(s(Object.assign({}, i)))).join('\n        '));
    check('and a formatted phone becomes digits only', o({ phone: '(801) 555-0123' }).phoneDigits === '8015550123',
      'got ' + JSON.stringify(o({ phone: '(801) 555-0123' }).phoneDigits) + ' — the lost-backslash bug');
  }
}

/* ---- warehouseRebuildFields: which changes send a house back to the warehouse */
{
  const fieldsA = constOf(admin, 'WAREHOUSE_BUILD_FIELDS'), fieldsS = constOf(fns, 'WAREHOUSE_BUILD_FIELDS');
  check('both sides watch the same warehouse fields', !!fieldsA && fieldsA === fieldsS,
    'office: ' + fieldsA + '\n        server: ' + fieldsS);
  const [o, s] = pair('warehouseRebuildFields',
    () => build(admin, ['warehouseRebuildFields'], fieldsA, 'warehouseRebuildFields'),
    () => build(fns, ['warehouseRebuildFields'], fieldsS, 'warehouseRebuildFields'));
  if (o && s) {
    const olds = [{}, { lightsDescription: 'Red', wireColor: 'green', outletTimer: 'No' },
                  { lightsDescription: '', lightsMarkedBuiltAt: 1 }, { wireColor: '' }];
    const news = [{ lightsDescription: 'Red' }, { lightsDescription: 'red ' }, { wireColor: 'White' },
                  { wireColor: 'green' }, { outletTimer: 'Yes' }, { outletTimer: 'no' }, { name: 'x' },
                  { lightsDescription: 'Blue', wireColor: 'brown', outletTimer: 'YES' }];
    let n = 0; const bad = [];
    olds.forEach(a => news.forEach(b => { n++; if (!same(o(a, b), s(a, b))) bad.push(JSON.stringify([a, b])); }));
    check('warehouseRebuildFields agrees on all ' + n + ' old/new combinations', bad.length === 0, bad.join('\n        '));
  }
}

/* ---- seasonYesUpdates: what saying yes to the season writes -------------------- */
{
  const [o, s] = pair('seasonYesUpdates',
    () => build(admin, ['rejoinNeedsBuild', 'stampBuildQueued', 'seasonYesUpdates'], '', 'seasonYesUpdates'),
    () => build(fns, ['rejoinNeedsBuildServer', 'stampBuildQueuedServer', 'seasonYesUpdates'], '', 'seasonYesUpdates'));
  if (o && s) {
    const ts = () => 'TS';
    const states = [];
    ['', 'yes', 'no', 'No', 'backnextyear', 'unanswered'].forEach(rs =>
      [false, true].forEach(mny => [false, true].forEach(rec => [false, true].forEach(build =>
        states.push({ rsvpStatus: rs, maybeNextYear: mny, needsLightRecycle: rec, needsLightBuild: build,
                      lightsDescription: 'Red', recycleKeepingCustomer: false })))));
    const bad = states.filter(st => !same(o(Object.assign({}, st), ts), s(Object.assign({}, st), ts)));
    check('seasonYesUpdates writes the same thing on both sides, over ' + states.length + ' states', bad.length === 0,
      bad.slice(0, 3).map(st => JSON.stringify(st)).join('\n        '));
  }
}

/* ---- quoteIsAddOn and referralSeasonNow: small, and still two copies ------------ */
{
  const [o, s] = pair('quoteIsAddOn',
    () => build(admin, ['quoteIsAddOn'], '', 'quoteIsAddOn'),
    () => build(fns, ['quoteIsAddOn'], '', 'quoteIsAddOn'));
  if (o && s) {
    const ins = [{ requoteKind: 'addition' }, { requoteKind: ' Addition ' }, { requoteKind: 'address' }, {}, null];
    check('quoteIsAddOn agrees', ins.every(i => o(i) === s(i)));
  }
  const [ra, rs] = pair('referralSeasonNow',
    () => build(admin, ['referralSeasonNow'], '', 'referralSeasonNow'),
    () => build(fns, ['referralSeasonNow'], '', 'referralSeasonNow'));
  if (ra && rs) check('referralSeasonNow agrees', ra() === rs());
}

/* ---- said No or Back Next Year: the Schedule widget's copy and the main app's ([[RS-81]]) --
   Both live in admin.html — the widget is a sealed IIFE the main app cannot call into, so the
   Routes tab carries its own. Not an office/server pair, but two copies of one rule all the same. */
{
  const [w, m] = pair('said no or back next year',
    () => build(admin, ['takedownSaidNo'], '', 'takedownSaidNo'),
    () => build(admin, ['saidNoOrBackNextYear'], '', 'saidNoOrBackNextYear'));
  if (w && m) {
    const st = [];
    ['', 'yes', 'no', ' No ', 'backnextyear', 'BackNextYear', 'unanswered', null].forEach(rs =>
      [false, true, undefined].forEach(f => st.push({ rsvpStatus: rs, maybeNextYear: f })));
    st.push(null, undefined);
    check('the Schedule and the Routes tab agree on who said No or Back Next Year',
      st.every(d => w(d) === m(d)), st.filter(d => w(d) !== m(d)).map(d => JSON.stringify(d)).join(', '));
    check('and the RSVP-link answer counts, not only the flag',
      m({ rsvpStatus: 'backnextyear' }) === true && m({ maybeNextYear: true }) === true && m({ rsvpStatus: 'yes' }) === false);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
