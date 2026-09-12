#!/usr/bin/env node
/* ============================================================================
 * WHAT SEARCH ENGINES ARE TOLD — and what they must never be shown.
 *
 * Added 2026-09-12, after reading what the site actually publishes. The public
 * page had a good <title> and description and nothing else: no canonical, no
 * structured data, no share card, no robots.txt, no sitemap — and no page in the
 * repo, staff screens included, said a word about indexing.
 *
 * ⭐ THE ONE CHECK THAT EARNS THIS FILE is the town list. `areaServed` in the
 * JSON-LD and the two <ul>s on the Areas We Serve page are the same claim written
 * twice, which is the shape this repo has been bitten by over and over — one rule,
 * two renderers, and nothing comparing them. Add Payson to the page and the markup
 * goes on telling Google about 29 towns that no longer match the 30 on screen. The
 * test is the only thing that can notice.
 *
 * ⚠ AND ONE CHECK IS A REFUSAL. The Google Business Profile carries 4.9 from 198
 * reviews. Putting that in aggregateRating markup here would be a lie about where
 * it came from, and Google's own guidelines call it out by name — review markup
 * describes reviews collected BY this site. The temptation is real and recurring,
 * so the absence is GATED rather than left to a comment nobody reads.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
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

console.log('\n=== What search engines are told ===\n');

const index = read('index.html');
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');
const CANON = 'https://highlightingutah.com/';

check('index.html was found', !!index);
check('robots.txt exists', !!robots, 'without one there is no way to keep a crawler off the token links');
check('sitemap.xml exists', !!sitemap);

/* ---------------------------------------------------------------- 1. The head */
if (index) {
  check('the page names one canonical URL',
    new RegExp('<link rel="canonical" href="' + CANON + '">').test(index),
    'every section is a hash route on this one document, so one canonical is the whole site');
  ['og:type', 'og:title', 'og:description', 'og:url', 'og:image'].forEach(p => {
    check('share card carries ' + p, new RegExp('property="' + p + '"').test(index),
      'a link pasted into a text message renders bare without it, on a business that runs on referral');
  });
  check('and a twitter card type', /name="twitter:card"/.test(index));

  const og = (index.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  check('the share image is an absolute URL', !!og && /^https:\/\//.test(og),
    'a relative og:image resolves against the scraper, not the site, and silently shows nothing');
  if (og) {
    const local = og.replace(CANON, '');
    check('and the share image actually exists in the repo', fs.existsSync(path.join(ROOT, local)),
      'og:image pointed at ' + local + ', which is not in the build');
  }
}

/* ------------------------------------------------- 2. The structured data */
let ld = null;
if (index) {
  const m = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  check('there is a structured-data block', !!m,
    'this is what tells Google it is a local business and which towns it covers');
  if (m) {
    try { ld = JSON.parse(m[1]); } catch (e) { ld = null; }
    check('and it is valid JSON', !!ld,
      'an unparseable block is silently ignored by every crawler, so it fails invisibly');
  }
}
if (ld) {
  check('it declares a local business type', /Business$/.test(String(ld['@type'] || '')),
    'got ' + ld['@type']);
  check('with the real phone number', ld.telephone === '+1-801-901-0011');
  check('and the real address for a business with no premises',
    !!ld.address && ld.address.addressRegion === 'UT' && !ld.address.streetAddress,
    'a service-area business states its region; inventing a street is a wrong answer ' +
    'to the one question this markup exists to answer');

  /* ⚠ THE REFUSAL. See the header. */
  const hasRating = 'aggregateRating' in ld || 'review' in ld ||
    /"aggregateRating"|"reviewRating"/.test(JSON.stringify(ld));
  check('and NO rating copied in from the Google profile', !hasRating,
    'The 4.9 from 198 reviews lives on the Google Business Profile, not on this site. ' +
    'Review markup must describe reviews this site collected — copying the number in is ' +
    'what earns a structured-data manual action. If a real on-site review system is ever ' +
    'built, this check is the thing to change, deliberately, in that same commit.');
}

/* ------------------------------- 3. The towns, which are written down twice */
if (index && ld) {
  const listTowns = id => {
    const block = (index.match(new RegExp('id="' + id + '"[\\s\\S]*?<\\/ul>')) || [])[0] || '';
    return (block.match(/<li>([^<]+)<\/li>/g) || []).map(x => x.replace(/<\/?li>/g, '').trim());
  };
  const onPage = [...new Set([...listTowns('utahCountyList'), ...listTowns('saltLakeCountyList')])].sort();
  const inMarkup = [...new Set((ld.areaServed || []).map(a => a.name))].sort();

  check('the Areas We Serve lists were found', onPage.length > 10,
    'found ' + onPage.length + ' — the id on one of those <ul>s has probably changed, ' +
    'which would make the comparison below vacuous rather than failing');
  check('and the structured data names exactly the towns the page does',
    onPage.length > 10 && onPage.join('|') === inMarkup.join('|'),
    'page: ' + onPage.length + ' towns, markup: ' + inMarkup.length + '\n        ' +
    'only on the page: [' + onPage.filter(t => inMarkup.indexOf(t) === -1).join(', ') + ']\n        ' +
    'only in the markup: [' + inMarkup.filter(t => onPage.indexOf(t) === -1).join(', ') + ']\n        ' +
    'These are one claim written twice. Add a city to Areas We Serve and add it here.');
  if (onPage.length > 10) note(onPage.length + ' towns are claimed, on the page and in the markup alike.');
}

/* --------------------------------------- 4. The staff screens stay unlisted */
const STAFF = ['admin.html', 'employee.html', 'connections.html'];
STAFF.forEach(f => {
  const html = read(f);
  check(f + ' tells search engines to stay out',
    !!html && /<meta name="robots" content="noindex, nofollow">/.test(html),
    'the office dashboard is a public URL — nothing stops it being indexed but this line');
});
if (index) {
  check('and the public page does NOT', !/<meta name="robots" content="noindex/.test(index),
    'noindex on the homepage would remove the whole business from Google');
}

/* ------------------------------------------------------------ 5. robots.txt */
if (robots) {
  ['/q/', '/r/', '/s/'].forEach(p => {
    check('robots.txt keeps crawlers off ' + p,
      new RegExp('^Disallow: ' + p.replace(/\//g, '\\/') + '\\s*$', 'm').test(robots),
      'that path carries a customer portal token — the whole of the credential in their email');
  });
  check('and it points at the sitemap',
    new RegExp('^Sitemap: ' + CANON + 'sitemap\\.xml\\s*$', 'm').test(robots));

  /* ⚠ THE BACKWARDS ONE. */
  const blockedStaff = STAFF.filter(f => new RegExp('^Disallow:.*' + f.replace('.', '\\.'), 'm').test(robots));
  check('and it does NOT Disallow the staff screens', blockedStaff.length === 0,
    'Disallowed: ' + blockedStaff.join(', ') + '. This looks like tightening and is the ' +
    'opposite: a crawler that may not FETCH a page can never read its noindex, so Google ' +
    'stays free to list the bare URL. Allowed + noindex is what keeps them out.');
}

/* ------------------------------------------------------------ 6. sitemap.xml */
if (sitemap) {
  check('the sitemap uses the real schema',
    /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/.test(sitemap),
    'a typo here (sitemap.org for sitemaps.org) is accepted by nothing and reported by nothing');
  const locs = (sitemap.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.replace(/<\/?loc>/g, ''));
  check('and lists the canonical URL', locs.indexOf(CANON) !== -1, 'found: ' + locs.join(', '));
  check('and lists nothing that is only a hash route',
    locs.every(u => u.indexOf('#') === -1),
    'a fragment is not a separate page and a sitemap claiming otherwise reports pages ' +
    'that do not exist');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('\nFailing: ' + failures.map(f => f.name).join(' | '));
  process.exit(1);
}
