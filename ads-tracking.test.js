#!/usr/bin/env node
/* ============================================================================
 * THE GOOGLE TAG — what it counts, and what it must never send.
 *
 * Added 2026-09-19 with /js/tracking.js, when the site first started measuring
 * visitors and Google Ads conversions ahead of a paid campaign.
 *
 * ⭐ THE CHECK THAT EARNS THIS FILE is section 2: a link carrying a customer's
 * token must never start the tag. /q/<token>, /r/<token>, /s/<token>, ?ref= and
 * the hash tokens are somebody's key to their own account, and a Google tag posts
 * the page address to Google on load. The tag is RUN here against each of those
 * addresses and the test fails if anything is queued for Google at all, or if the
 * token appears anywhere in what would be sent.
 *
 * ⚠ AND THE STAFF SCREENS NEVER LOAD IT (section 1). Office traffic would swamp
 * the numbers the ad budget is decided on.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = __dirname;

let passed = 0, failed = 0, notes = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS  ' + name); return; }
  failed++; failures.push({ name, detail });
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}
function note(msg) { notes++; console.log('  NOTE  ' + msg); }
const read = f => {
  const p = path.join(ROOT, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

console.log('\n=== The Google tag ===\n');

const src = read('js/tracking.js');
const index = read('index.html');
check('js/tracking.js exists', !!src);
check('index.html exists', !!index);

/* ------------------------------------------------ 1. who loads it */
check('index.html loads it root-absolute',
  !!index && index.indexOf('<script src="/js/tracking.js"></script>') !== -1,
  'a relative src resolves to /q/js/tracking.js on a quote link and 404s');
['admin.html', 'employee.html', 'connections.html'].forEach(f => {
  const s = read(f);
  if (s === null) { note(f + ' not found — skipped'); return; }
  check(f + ' does not load the tag',
    !/tracking\.js|googletagmanager\.com|gtag\(/.test(s),
    'staff screens are opened all day by the office; tagging them would swamp the ' +
    'visitor numbers and could teach Ads to find people like the office staff');
});

/* ------------------------------------------------ run it in a fake browser */
function run(url, opts) {
  opts = opts || {};
  const u = new URL(url);
  const store = Object.assign({}, opts.store || {});
  const appended = [];
  const listeners = [];
  const win = {
    location: { href: u.href, origin: u.origin, hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    document: {
      createElement: () => ({}),
      head: { appendChild: el => appended.push(el) },
      addEventListener: (t, fn) => listeners.push({ t, fn })
    }
  };
  win.window = win;
  const code = opts.patch ? opts.patch(src) : src;
  vm.runInNewContext(code, win);
  return { win, store, appended, listeners, dl: win.dataLayer || [], api: win.huTrack };
}
const flat = dl => JSON.stringify(dl.map(a => Array.prototype.slice.call(a)));

if (src) {
  /* -------------------------------------------- 2. token links are never tagged */
  const TOKEN = 'SECRETtok123';
  const privateLinks = [
    'https://highlightingutah.com/q/' + TOKEN,
    'https://highlightingutah.com/q/' + TOKEN + '?p=' + TOKEN,
    'https://highlightingutah.com/r/' + TOKEN,
    'https://highlightingutah.com/s/' + TOKEN,
    'https://highlightingutah.com/?ref=' + TOKEN + '#/quote',
    'https://highlightingutah.com/#/quote-details?token=' + TOKEN,
    'https://highlightingutah.com/#/?token=' + TOKEN + '&rsvp=back',
    'https://highlightingutah.com/#/share?t=' + TOKEN
  ];
  privateLinks.forEach(link => {
    const r = run(link);
    check('not started on ' + link.replace('https://highlightingutah.com', ''),
      r.appended.length === 0 && r.dl.length === 0 && !r.api._test.isEnabled() &&
      JSON.stringify(r.store).indexOf(TOKEN) === -1,
      'the tag posts the page address to Google; this address is a customer\'s key');
  });

  /* ---------------------------------------- 3. not on previews or localhost */
  ['http://localhost:4173/', 'https://deploy-preview-12--highlighting-utah.netlify.app/'].forEach(link => {
    const r = run(link + '?gclid=x');
    check('not started on ' + new URL(link).hostname, r.appended.length === 0 && r.dl.length === 0,
      'test and preview clicks would land in the numbers the budget is decided on');
  });

  /* The shipped CONFIG carries the real Ads ID since 2026-09-19, so the "Ads dormant"
     half is run against a copy with the ID blanked, and section 6 against invented ones. */
  const dormant = s => s.replace(/ads: 'AW-[^']*',/, "ads: '',");
  const invented = s => s.replace(/ads: '[^']*',/, "ads: 'AW-111',")
    .replace(/labels: \{[^}]*\}/, "labels: { quote: 'LQ', contact: 'LC', call: '' }");

  /* ------------------------------------------------ 4. an ordinary ad click */
  const ad = run('https://highlightingutah.com/?gclid=G1&utm_source=google&utm_campaign=xmas&fbclid=zz&ref2=q#/quote', { patch: dormant });
  check('the dormant copy really has no Ads ID (test guard)', ad.api._test.CONFIG.ads === '',
    'the CONFIG block was reworded; update the dormant() pattern above');
  check('started on the real domain', ad.appended.length === 1 && ad.api._test.isEnabled());
  check('loads gtag.js from Google', ad.appended[0] && /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=/.test(ad.appended[0].src));
  const cfg = ad.dl.map(a => Array.prototype.slice.call(a)).filter(a => a[0] === 'config');
  check('Analytics is configured with G-44SCT38S6E', cfg.some(a => a[1] === 'G-44SCT38S6E'));
  const loc = cfg[0] && cfg[0][2] && cfg[0][2].page_location;
  check('the address sent keeps only the ad parameters and drops the hash',
    loc === 'https://highlightingutah.com/?gclid=G1&utm_source=google&utm_campaign=xmas',
    'got ' + loc);
  const saved = JSON.parse(ad.store.huAdClick || 'null');
  check('the ad click is remembered for the quote',
    !!saved && saved.gclid === 'G1' && saved.utm_campaign === 'xmas' && !!saved.landedAt && !('fbclid' in saved));
  check('one capture-phase click listener catches every tel: link',
    ad.listeners.length === 1 && ad.listeners[0].t === 'click');

  /* ---------------------------------------- 5. conversions, Ads dormant */
  ad.api.quoteSubmitted({ id: 'Q1', email: ' Jo@Example.com ', phone: '(801) 555-1234' });
  let calls = ad.dl.map(a => Array.prototype.slice.call(a));
  check('a quote is an Analytics lead', calls.some(a => a[0] === 'event' && a[1] === 'generate_lead' && a[2].form === 'quote'));
  check('with no Ads ID nothing is sent as an Ads conversion',
    !calls.some(a => a[0] === 'event' && a[1] === 'conversion'));
  const ud = calls.find(a => a[0] === 'set' && a[1] === 'user_data');
  check('enhanced-conversion data is normalised',
    ud && ud[2].email === 'jo@example.com' && ud[2].phone_number === '+18015551234',
    JSON.stringify(ud));

  /* ---------------------------------------- 6. conversions, Ads filled in */
  const live = run('https://highlightingutah.com/', { patch: invented });
  check('the patch took (test guard)', live.api._test.CONFIG.ads === 'AW-111' && live.api._test.CONFIG.labels.quote === 'LQ',
    'the CONFIG block was reworded; update the invented() patterns above');
  live.api.quoteSubmitted({ id: 'Q9', email: 'a@b.co', phone: '8015550000' });
  live.api.contactSent();
  live.api.callClicked();
  calls = live.dl.map(a => Array.prototype.slice.call(a));
  const conv = calls.filter(a => a[0] === 'event' && a[1] === 'conversion').map(a => a[2]);
  check('the Ads tag is configured too', calls.some(a => a[0] === 'config' && a[1] === 'AW-111'));
  check('a quote is an Ads conversion, de-duplicated on the quote id',
    conv.some(c => c.send_to === 'AW-111/LQ' && c.transaction_id === 'Q9'));
  check('a message is an Ads conversion', conv.some(c => c.send_to === 'AW-111/LC'));
  check('an empty label sends nothing (call)', conv.length === 2, JSON.stringify(conv));
  check('a call tap is still an Analytics event', calls.some(a => a[0] === 'event' && a[1] === 'click_to_call'));

  /* ---------------------------------------- 6b. what actually ships */
  const shipped = run('https://highlightingutah.com/');
  const sc = shipped.api._test.CONFIG;
  check('the shipped Ads ID looks like one', /^AW-\d{6,}$/.test(sc.ads), 'got ' + sc.ads);
  check('and the quote label is filled in', /^[\w-]{10,}$/.test(sc.labels.quote), 'got ' + sc.labels.quote);
  shipped.api.quoteSubmitted({ id: 'QS' });
  check('so a saved quote reaches Google Ads as the real conversion',
    shipped.dl.map(a => Array.prototype.slice.call(a))
      .some(a => a[0] === 'event' && a[1] === 'conversion' && a[2].send_to === sc.ads + '/' + sc.labels.quote && a[2].transaction_id === 'QS'));

  /* ---------------------------------------- 7. helpers */
  const t = ad.api._test;
  const now = Date.parse('2026-10-15T00:00:00Z');
  const mk = d => ({ getItem: () => JSON.stringify({ gclid: 'g', landedAt: new Date(now - d * 86400000).toISOString() }) });
  check('an ad click 30 days old still labels the quote', !!t.adClickForQuote(mk(30), now));
  check('one 91 days old does not', t.adClickForQuote(mk(91), now) === null);
  check('no stored click is null, not {}', t.adClickForQuote({ getItem: () => null }, now) === null);
  check('e164 handles the usual shapes',
    t.e164('801-555-1234') === '+18015551234' && t.e164('1 (801) 555 1234') === '+18015551234' && t.e164('555-1234') === '');
  const disabled = run('http://localhost/');
  let threw = false;
  try { disabled.api.quoteSubmitted({ id: 'x' }); disabled.api.contactSent(); disabled.api.callClicked(); } catch (e) { threw = true; }
  check('every call is a quiet no-op when the tag is off', !threw && disabled.dl.length === 0);
}

/* ------------------------------------------------ 8. the page wiring */
if (index) {
  const handler = (index.match(/quoteFormEl\.addEventListener\('submit'[\s\S]*?\n\}\);/) || [])[0] || '';
  check('the quote submit handler was found', handler.length > 500);
  const thenAt = handler.indexOf('.then(function(ref){');
  const trackAt = handler.indexOf("trackSafely('quoteSubmitted'");
  const catchAt = handler.indexOf('}).catch(');
  check('a quote is counted only after it is saved',
    thenAt !== -1 && trackAt > thenAt && trackAt < catchAt,
    'counting on the button press would pay Google for failed submits');
  check('the quote carries the ad click', /Object\.assign\(referralQuoteFields\(\), adClickQuoteFields\(\), \{/.test(handler));
  const ts = (index.match(/function trackSafely[\s\S]*?\n\}/) || [])[0] || '';
  check('trackSafely cannot throw into the save\'s .catch', /try\{/.test(ts) && /catch\(err\)/.test(ts),
    'a throw there tells a customer whose quote WAS saved that it failed');
  check('a message is counted after it is sent', /classList\.add\('show'\);\n?\r?\n?\s*trackSafely\('contactSent'\)/.test(index));

  /* ------------------------------------------------ 9. the privacy policy */
  const page = (index.match(/<div id="page-privacy" class="page">[\s\S]*?\n<\/div>/) || [])[0] || '';
  check('the privacy policy is a real page', page.length > 1500);
  check('it names Google Analytics and Google Ads', /Google Analytics/.test(page) && /Google Ads/.test(page),
    'Ads requires the policy to disclose the tags the site actually runs');
  check('it discloses the hashed email/phone, because tracking.js sends them',
    !/user_data/.test(src || '') || /hashed/.test(page));
  check('the footer links to it, and no footer link is href="#"',
    index.indexOf('<a href="/privacy"') !== -1 && !/<a href="#" style="color:inherit; text-decoration:underline;">/.test(index));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('\nFailing: ' + failures.map(f => f.name).join(' | '));
  process.exit(1);
}
