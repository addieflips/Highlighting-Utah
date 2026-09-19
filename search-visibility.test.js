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
 * ⭐ SECTION 7 WAS ADDED 2026-09-12, when six of those sections stopped being hash
 * routes and became real paths. The list of them is written down in FOUR files —
 * PATH_ROUTES, _redirects, sitemap.xml, _headers — and every pair of those can
 * drift silently, each in a different direction. That section is the comparison.
 *
 * ⚠ AND TWO CHECKS ARE A REFUSAL. The Google Business Profile carries 4.9 from 198
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
    'this is the HOME answer. Six sections now answer on real paths and the router\n     rewrites this tag per route (applyRouteMeta), so the tag in the file has to stay\n     the homepage — hard-coding a section URL here would make all seven canonical to it');
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
  check('and lists no /quote, /payment, /quote-details or /share',
    !locs.some(u => /\/(quote|quote-details|payment|share)$/.test(u)),
    'those four are a form, an account and a private link, not search results. They are ' +
    'hash-only routes with no address to list, and publishing one invites Google to crawl ' +
    'a screen that exists to be reached from an email.');
}

/* ============================================================================
 * 7. THE SIX REAL PATHS, WHICH FOUR FILES HAVE TO AGREE ABOUT (2026-09-12)
 *
 * ⭐ THIS IS THE CHECK THAT EARNS ITS PLACE. Until this change the site was one
 * URL: every section was a hash route, and a fragment is not a page. Six of them
 * now answer on a real path, and that one list is written down in FOUR places —
 * PATH_ROUTES in index.html, the rewrites in _redirects, the <loc>s in
 * sitemap.xml, and the no-cache entries in _headers. Every pair can drift, and
 * each drift fails in a different and quiet way:
 *
 *   in sitemap, not in _redirects  -> a 404 we asked Google to crawl
 *   in PATH_ROUTES, not in _redirects -> the nav works, a typed URL 404s
 *   in _redirects, not in sitemap  -> a page that works and is never found
 *   missing from _headers          -> a stale app served to a searcher
 *
 * Nothing but a comparison can see any of those, because each file is valid on
 * its own. This section is that comparison.
 *
 * ⚠ AND ONE OF THESE IS A REFUSAL, like the aggregateRating one above. /quote,
 * /quote-details, /payment and /share must NOT become real paths. They are a
 * form, an account and a private link; they stay hash-only so there is no URL to
 * index, and the money paths stay untouched by routing work. Adding one here
 * would publish a customer account screen.
 * ========================================================================== */
const redirects = read('_redirects');
const headers = read('_headers');
check('_redirects exists', !!redirects, 'without it every real path 404s on Netlify');
check('_headers exists', !!headers);

const PATH_ROUTES = (() => {
  const m = index && index.match(/var PATH_ROUTES = \[([^\]]*)\];/);
  if (!m) return [];
  return m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

/* The guard, for the same reason the town list has one: if the declaration is
   renamed this parses to [] and every comparison below passes vacuously. */
/* ⭐ 8 SINCE 2026-09-19: /privacy joined, because Google Ads needs a privacy policy at a
   real address. It is a marketing path in every sense this file checks. */
check('PATH_ROUTES was found in index.html', PATH_ROUTES.length === 8,
  'parsed ' + PATH_ROUTES.length + ' routes ' + JSON.stringify(PATH_ROUTES) +
  ' — expected 8 (/ plus the six marketing pages and /privacy). If a route was deliberately ' +
  'added or removed, change this number in the same commit; otherwise the ' +
  'declaration has been renamed and every check below is comparing empty lists.');
check('and / is one of them', PATH_ROUTES.indexOf('/') !== -1);

const TRANSACTIONAL = ['/quote', '/quote-details', '/payment', '/share'];
check('and none of the four private routes is a real path',
  !TRANSACTIONAL.some(r => PATH_ROUTES.indexOf(r) !== -1),
  'found ' + TRANSACTIONAL.filter(r => PATH_ROUTES.indexOf(r) !== -1).join(', ') +
  ' in PATH_ROUTES. Those screens are reached from an email or a form, never from ' +
  'a search result, and giving one an address publishes it. See the header.');

const marketing = PATH_ROUTES.filter(r => r !== '/');

/* ------------------------------------------- every path is actually served */
if (redirects) {
  const rewritten = (redirects.match(/^(\/\S*)\s+\/index\.html\s+200\s*$/gm) || [])
    .map(l => l.trim().split(/\s+/)[0]);
  check('_redirects has a rewrite for every marketing path',
    marketing.every(r => rewritten.indexOf(r) !== -1),
    'missing: [' + marketing.filter(r => rewritten.indexOf(r) === -1).join(', ') + ']\n        ' +
    'Netlify has no file at that address, so without the rewrite it is a 404 — for ' +
    'a URL the sitemap is telling Google to crawl.');
  check('and it is not a catch-all', rewritten.indexOf('/*') === -1,
    'a /* rewrite answers 200 to every mistyped address on the domain, which turns ' +
    'every typo into a soft 404 and hides real broken links from us as well. ' +
    'An unknown path should 404.');
}

if (headers) {
  const noCache = (headers.match(/^(\/\S*)\s*$/gm) || []).map(l => l.trim());
  check('_headers keeps every marketing path out of the browser cache',
    marketing.every(r => noCache.indexOf(r) !== -1),
    'missing: [' + marketing.filter(r => noCache.indexOf(r) === -1).join(', ') + ']\n        ' +
    'Each one is a rewrite to index.html, so it is the app under another address. ' +
    'It matches neither /index.html nor / , which is the same gap /q/* had to be ' +
    'added for: a cached copy is a stale copy of the whole app.');
}

/* ------------------------------------ the sitemap names exactly these paths */
if (sitemap && PATH_ROUTES.length === 8) {
  const locs2 = (sitemap.match(/<loc>([^<]+)<\/loc>/g) || []).map(x => x.replace(/<\/?loc>/g, ''));
  const expected = PATH_ROUTES.map(r => CANON + (r === '/' ? '' : r.slice(1))).sort();
  check('the sitemap names exactly the real paths and nothing else',
    locs2.slice().sort().join('|') === expected.join('|'),
    'sitemap: [' + locs2.join(', ') + ']\n        expected: [' + expected.join(', ') + ']\n        ' +
    'These are one list written twice. A URL here that is not a route is a page ' +
    'that does not exist; a route missing here is a page nothing will find.');
  note(locs2.length + ' URLs published, one per real path.');
}

/* -------------------------- and each of them says something different */
if (index && PATH_ROUTES.length === 8) {
  const metaBlock = (index.match(/var ROUTE_META = \{([\s\S]*?)\n\};/) || [])[1] || '';
  check('ROUTE_META was found', metaBlock.length > 200,
    'without it the per-route title and description checks below are vacuous');

  const entry = route => {
    const key = "'" + route + "': {";
    const at = metaBlock.indexOf(key);
    if (at === -1) return null;
    let rest = metaBlock.slice(at + key.length);
    const end = rest.search(/\n  '/);
    if (end !== -1) rest = rest.slice(0, end);
    /* ⚠ \b ON BOTH KEYS, AND THE RED-CHECK IS WHY. Without it `desc:` matches
       inside `notdesc:` — so renaming the key to anything ending in "desc" was
       read as a description of whatever followed, and the missing-description
       check stayed green while the length check failed instead. A check that
       goes red for the wrong reason sends the next person to the wrong line.
       Same trap waits on `title:` inside `subtitle:`. */
    return {
      title: (rest.match(/\btitle:\s*'((?:[^'\\]|\\.)*)'/) || [])[1],
      desc: (rest.match(/\bdesc:\s*'((?:[^'\\]|\\.)*)'/) || [])[1]
    };
  };

  const entries = marketing.map(r => ({ route: r, meta: entry(r) }));
  const missing = entries.filter(e => !e.meta || !e.meta.title || !e.meta.desc);
  check('every marketing path has its own title and description',
    missing.length === 0,
    'without one: [' + missing.map(e => e.route).join(', ') + ']\n        ' +
    'Seven URLs serving this one document are seven duplicates unless each says ' +
    'something different. This is the half of the change that makes the paths worth ' +
    'having, and a route added without these two strings is a route Google will fold ' +
    'back into the homepage.');

  if (missing.length === 0) {
    const titles = entries.map(e => e.meta.title);
    const descs = entries.map(e => e.meta.desc);
    check('and no two of them are the same title',
      new Set(titles).size === titles.length,
      'duplicate titles are the single clearest signal to Google that two URLs are ' +
      'the same page');
    check('and no two of them are the same description',
      new Set(descs).size === descs.length);
    const longT = entries.filter(e => e.meta.title.length > 65);
    check('and every title fits a search result',
      longT.length === 0,
      'over 65 characters: ' + longT.map(e => e.route + ' (' + e.meta.title.length + ')').join(', ') +
      ' — Google truncates it, so the end of the sentence is written for nobody');
    const badD = entries.filter(e => e.meta.desc.length < 70 || e.meta.desc.length > 170);
    check('and every description is a usable length',
      badD.length === 0,
      'outside 70-170 characters: ' +
      badD.map(e => e.route + ' (' + e.meta.desc.length + ')').join(', '));
    note(PATH_ROUTES.length + ' URLs, each with its own title, description and canonical.');
  }

  /* -------------- the head is rewritten per route, not left on the homepage */
  ['document.title =', 'link[rel="canonical"]', 'og:url'].forEach(bit => {
    check('applyRouteMeta updates ' + bit,
      index.indexOf(bit) !== -1 && /function applyRouteMeta/.test(index),
      'the static tags in the head describe the homepage; if the router does not ' +
      'rewrite them, all seven URLs claim to be the homepage');
  });
  check('and the static canonical is still the homepage',
    new RegExp('<link rel="canonical" href="' + CANON + '">').test(index),
    'the tag in the file is the home answer and the router edits it per route. ' +
    'Hard-coding a section URL here would make every route canonical to that one.');

  /* ------------------------- nothing is reachable only from the sitemap */
  const orphans = marketing.filter(r => index.indexOf('href="' + r + '"') === -1);
  check('and every marketing path is linked from the page itself',
    orphans.length === 0,
    'linked from nowhere: [' + orphans.join(', ') + ']\n        ' +
    'A URL only a sitemap knows about is an orphan: it gets crawled and carries no ' +
    'internal weight. These used to be href="#/faq", which a crawler does not follow ' +
    'at all — converting them is what makes the nav and footer real links.');

  /* ------- and the private routes are still hash links, which is what keeps
             every quote and portal link already sent to a customer working */
  const leaked = TRANSACTIONAL.filter(r => index.indexOf('href="' + r + '"') !== -1);
  check('and the private routes are still linked by hash, not by path',
    leaked.length === 0,
    'found a path link to: [' + leaked.join(', ') + ']. Those must stay href="#' + '/..." — ' +
    'the hash is what every quote email, RSVP button and referral link in a ' +
    'customer inbox already uses, and what navigate() reads first.');
}

/* ----------------------------------- the FAQ markup, generated not retyped */
if (index) {
  check('the FAQ markup is generated from the FAQ the page shows',
    /function syncFaqSchema/.test(index) && /mainEntity: FAQS\.map/.test(index),
    'FAQS is replaced wholesale by the Firestore snapshot, so a hand-written copy ' +
    'of the questions would describe last season to Google with nothing able to ' +
    'notice. Building it from FAQS is what makes that impossible.');
  check('and it is only published on /faq',
    /route !== '\/faq'/.test(index),
    'this block sits in the head of a document that answers on seven URLs — left ' +
    'in place it claims the homepage and the gallery are FAQ pages too');
  const faqBlock = (index.match(/function syncFaqSchema[\s\S]*?\n\}/) || [])[0] || '';
  check('and it carries no rating either',
    faqBlock.length > 100 && !/aggregateRating|reviewRating/.test(faqBlock),
    'same refusal as the business block: a rating here would still be describing ' +
    'reviews this site did not collect');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + notes + ' notes');
if (failed) {
  console.log('\nFailing: ' + failures.map(f => f.name).join(' | '));
  process.exit(1);
}
