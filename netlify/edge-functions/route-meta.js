/* ============================================================================
 * EACH MARKETING PAGE ARRIVES WITH ITS OWN HEAD (added 2026-09-19).
 *
 * The six marketing paths are Netlify rewrites to index.html (see _redirects),
 * so the HTML the server sent for /faq was the homepage's: the homepage title,
 * description and canonical. applyRouteMeta() in index.html corrects all of
 * that, but only once JavaScript runs, and that leaves two problems:
 *
 *   1. Google reads the canonical in the HTML it downloads BEFORE it renders the
 *      page. Its guidance is not to change the canonical with JavaScript to
 *      something different from the downloaded one. Six pages told Google
 *      "I am the homepage" and then "I am /faq". That conflict is how a page
 *      gets folded into the homepage and never ranks on its own.
 *   2. Bing, Facebook, iMessage, Slack and every other link preview read the
 *      downloaded HTML and run no JavaScript at all, so all six pages showed the
 *      homepage's title and blurb.
 *
 * This function rewrites those tags in the downloaded HTML, so it agrees with
 * applyRouteMeta() before any script runs. It also adds a BreadcrumbList. Nothing
 * else in the document changes.
 *
 * ⚠ THE TABLE BELOW IS ROUTE_META IN index.html, WRITTEN A SECOND TIME. There is
 * no build step to share one copy, so search-visibility.test.js compares them
 * and fails the moment they differ. Change a title in one and change it in both.
 *
 * ⚠ onError: 'bypass'. If this throws, Netlify serves index.html unchanged,
 * which is exactly what the site did before this file existed. A bug here can
 * cost the per-page head, and it cannot take the site down.
 * ========================================================================== */

const CANON = 'https://highlightingutah.com/';

export const ROUTES = {
  '/how-it-works': {
    name: 'How It Works',
    title: 'How It Works & Cost | Highlighting Utah Christmas Lights',
    desc: 'How Christmas light installation works and what it costs: priced per foot of roofline, with the lights, install, in-season repairs and January takedown included.'
  },
  '/gallery': {
    name: 'Gallery',
    title: 'Install Gallery | Highlighting Utah Christmas Lights',
    desc: 'Rooflines, dormers, peaks and porches lit across Utah County and Salt Lake County. See finished residential Christmas light installations.'
  },
  '/reviews': {
    name: 'Reviews',
    title: 'Customer Reviews | Highlighting Utah Christmas Lights',
    desc: 'What homeowners in Lehi, Orem, Provo, American Fork and Pleasant Grove say about having Highlighting Utah install their Christmas lights.'
  },
  '/areas': {
    name: 'Areas We Serve',
    title: 'Areas We Serve | Utah County & Salt Lake County',
    desc: 'Christmas light installation across Utah County and Salt Lake County — Lehi, Orem, Provo, American Fork, Draper, Sandy and twenty more cities.'
  },
  '/faq': {
    name: 'FAQ',
    title: 'Christmas Light Installation FAQ | Highlighting Utah',
    desc: 'Do you provide the lights? Will it damage my roof? How does pricing work? Answers to what homeowners ask most about Christmas lights in Utah.'
  },
  '/contact': {
    name: 'Contact',
    title: 'Contact Us | Highlighting Utah Christmas Lights',
    desc: 'Call (801) 901-0011 or send a message to Highlighting Utah for a free Christmas light installation quote in Utah County or Salt Lake County.'
  },
  '/privacy': {
    name: 'Privacy Policy',
    title: 'Privacy Policy | Highlighting Utah',
    desc: 'How Highlighting Utah collects, uses and protects the information you give us when you ask for a Christmas light quote or become a customer.'
  }
};

const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Pure, so the test can run it against the real index.html without Netlify. */
export function rewriteHead(html, route) {
  const meta = ROUTES[route];
  if (!meta) return html;
  const url = CANON + route.slice(1);
  const t = esc(meta.title), d = esc(meta.desc);
  const crumbs = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: CANON },
      { '@type': 'ListItem', position: 2, name: meta.name, item: url }
    ]
  }).replace(/</g, '\\u003c');
  return html
    .replace(/<title>[^<]*<\/title>/, '<title>' + t + '</title>')
    .replace(/(<meta name="description" content=")[^"]*(")/, '$1' + d + '$2')
    .replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + url + '$2')
    .replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + url + '$2')
    .replace(/(<meta property="og:title" content=")[^"]*(")/, '$1' + t + '$2')
    .replace(/(<meta property="og:description" content=")[^"]*(")/, '$1' + d + '$2')
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, '$1' + t + '$2')
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, '$1' + d + '$2')
    .replace('</head>', '<script type="application/ld+json" id="breadcrumbSchema">' + crumbs + '</script>\n</head>');
}

export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (response.status !== 200 || type.indexOf('text/html') === -1) return response;

  /* /faq/ answers too; both get the one canonical without the slash */
  const route = new URL(request.url).pathname.replace(/\/+$/, '');
  if (!ROUTES[route]) return response;

  const html = rewriteHead(await response.text(), route);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  return new Response(html, { status: 200, headers });
};

export const config = {
  path: [
    '/how-it-works', '/how-it-works/',
    '/gallery', '/gallery/',
    '/reviews', '/reviews/',
    '/areas', '/areas/',
    '/faq', '/faq/',
    '/contact', '/contact/',
    '/privacy', '/privacy/'
  ],
  onError: 'bypass'
};
