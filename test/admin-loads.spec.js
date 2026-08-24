/*
 * DOES admin.html ACTUALLY LOAD?
 *
 * ⭐ WHY THIS EXISTS (added 2026-08-24). Until now NOTHING in the whole test estate
 * ever opened admin.html in a browser. The Playwright specs drive index.html; gate A
 * (verify-syntax.js) proves the inline scripts PARSE, which is a much weaker claim —
 * a page can parse perfectly and still die on its first line at runtime.
 *
 * That gap sat directly under the riskiest kind of change this repo makes. The
 * module script now opens with four local imports (js/money.js, js/svdepth.js,
 * js/schedule-rules.js, js/season-rules.js). A mistyped path, a name that is
 * imported but never exported, or a duplicate top-level declaration is a HARD
 * failure: the browser refuses the whole module and the admin page renders as a
 * dead login box with one line in a console nobody has open. Every automated check
 * in this repo would still be green, because every one of them reads the file as
 * text rather than running it.
 *
 * ⚠ THIS IS A SMOKE TEST, NOT A FEATURE TEST. It asserts the page boots: modules
 * resolve, the module script executes, and nothing throws on the way. It does not
 * log in and it does not touch a panel — Firebase is stubbed and the app never gets
 * past the login gate, which is exactly what we want from a test that must never
 * reach real data (CLAUDE.md §9.4).
 *
 * ⚠ AND IT MUST NOT BE "FIXED" BY IGNORING ERRORS. If this goes red, the admin page
 * is broken in a browser. Widening the ignore list to get green would hide the one
 * failure this file exists to catch.
 */

const { test, expect } = require('@playwright/test');

/* The exact names admin.html imports from the Firebase CDN. Kept here rather than
   derived, so that adding an import to the page without adding it here fails LOUDLY
   ("does not provide an export named …") instead of silently drifting. */
const FIREBASE_MODULES = {
  'firebase-app.js': ['initializeApp'],
  'firebase-auth.js': ['getAuth', 'signInWithEmailAndPassword', 'onAuthStateChanged', 'signOut'],
  'firebase-firestore.js': ['getFirestore', 'collection', 'doc', 'addDoc', 'setDoc', 'updateDoc',
    'deleteDoc', 'onSnapshot', 'query', 'orderBy', 'where', 'serverTimestamp', 'getDoc', 'getDocs',
    'limit', 'Timestamp', 'increment', 'arrayUnion'],
  'firebase-functions.js': ['getFunctions', 'httpsCallable']
};

/* Every export is an inert function. onSnapshot has to return an unsubscribe
   function, because admin.html stores what it returns. */
function fakeModule(names) {
  return names.map(n => {
    if (n === 'onSnapshot') return 'export function onSnapshot(){ return function(){}; }';
    if (n === 'Timestamp') return 'export const Timestamp = { now: () => ({ toDate: () => new Date() }) };';
    return 'export function ' + n + '(){ return {}; }';
  }).join('\n');
}

/* Anything that would reach a real backend. Same rule as test/firebase-stub.js:
   aborted and recorded, never quietly allowed. */
const FORBIDDEN = ['firestore.googleapis.com', 'firebase.googleapis.com',
  'identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'cloudfunctions.net',
  'run.app', 'firebaseio.com', 'paypal.com', 'api.emailjs.com', 'cloudinary.com'];

test.describe('The admin page', () => {
  test('boots in a real browser — every module resolves and the app starts', async ({ page }) => {
    const escapes = [];
    const pageErrors = [];
    const consoleErrors = [];
    const missingAssets = [];

    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    /* ⚠ TRACKED AS REQUESTS, NOT AS CONSOLE TEXT. The first version of this scraped
       the console for /404|net::ERR/ and went red on a healthy page, because ABORTING
       the real Firebase endpoints — which this test does on purpose — logs
       net::ERR_CONNECTION_RESET too. "A module we ship did not arrive" and "we
       deliberately blocked a backend" are different events and only look alike in the
       console. Same-origin only: everything the page legitimately owns. */
    const sameOrigin = u => /127\.0\.0\.1:4173|localhost:4173/.test(u);
    page.on('response', r => {
      if (sameOrigin(r.url()) && r.status() >= 400) missingAssets.push(r.status() + ' ' + r.url());
    });
    page.on('requestfailed', r => {
      if (sameOrigin(r.url())) missingAssets.push('failed ' + r.url());
    });

    /* ONE handler, explicit order — Playwright matches routes last-registered-first,
       and the multi-route version of this in firebase-stub.js was silently broken
       for exactly that reason. */
    await page.route('**/*', route => {
      const url = route.request().url();

      for (const [file, names] of Object.entries(FIREBASE_MODULES)) {
        if (url.includes(file)) {
          return route.fulfill({ status: 200,
            contentType: 'application/javascript; charset=utf-8', body: fakeModule(names) });
        }
      }
      /* Third-party <script> tags the page loads before its module: Google Maps,
         EmailJS, SheetJS. Served empty — the module must boot without them. */
      if (url.includes('maps.googleapis.com') || url.includes('@emailjs') || url.includes('xlsx')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      }
      if (FORBIDDEN.some(h => url.includes(h))) { escapes.push(url); return route.abort(); }
      return route.continue();
    });

    const resp = await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
    expect(resp.status(), 'admin.html should be served').toBe(200);

    /* Give the module script a moment to run and throw if it is going to. */
    await page.waitForTimeout(1500);

    /* ---- 1. the module resolved and executed ---------------------------------
       A module that fails to resolve never runs, so nothing it declares exists.
       Asking the page for something the module OWNS is the difference between
       "the file was served" and "the file ran". */
    /* ⚠ THE PROBE MUST BE SOMETHING THE MODULE CREATES, NEVER STATIC MARKUP. The
       first version of this OR-ed in `document.querySelectorAll('.nav-item').length`,
       which is markup that is in the file whether or not a single line of script ran
       — so it was true even when the browser had refused the module outright. A
       red-check caught it: pointing an import at a path that does not exist left this
       test green, which is precisely the failure it was written to catch.
       window.scheduleSyncFromCustomers is set by the Schedule widget at the very end
       of the module, so it is only there if the whole thing resolved and ran. */
    const booted = await page.evaluate(() => ({
      eligibilityPicker: !!document.getElementById('seasonEligibilitySelect'),
      moduleRan: typeof window.scheduleSyncFromCustomers === 'function'
        && typeof window.scheduleOnCustomersUpdated === 'function'
    }));

    /* ---- 2. nothing that means "the module was refused" ---------------------- */
    const fatal = [...pageErrors, ...consoleErrors].filter(t =>
      /Failed to resolve module|does not provide an export|Cannot use import|Unexpected token|SyntaxError|has already been declared|Identifier .* has already/i.test(t));

    expect(fatal, 'the browser refused the module — admin.html would be a dead page\n'
      + fatal.join('\n')).toEqual([]);

    /* ---- 2b. and no module of ours that simply failed to arrive --------------
       A wrong import path is a 404, not a syntax error, so it never matches the list
       above — but it still kills the page: one unresolved import and the browser
       refuses the whole module. */
    expect(missingAssets, 'a file this page ships did not load — one bad import path '
      + 'is enough to refuse the whole module\n' + missingAssets.join('\n')).toEqual([]);

    /* ---- 3. and specifically not the two modules this branch added ----------- */
    const mine = [...pageErrors, ...consoleErrors]
      .filter(t => /schedule-rules|season-rules/i.test(t));
    expect(mine, 'an error naming one of the new rule modules\n' + mine.join('\n')).toEqual([]);

    /* ---- 4. the page really did come up ------------------------------------- */
    expect(booted.moduleRan, 'the module script did not execute — the page is dead').toBe(true);
    expect(booted.eligibilityPicker,
      'the season-eligibility picker is missing from the page').toBe(true);

    /* ---- 5. and nothing reached anything real ------------------------------- */
    expect(escapes, 'the page tried to reach a REAL backend — see CLAUDE.md §9.4\n'
      + escapes.join('\n')).toEqual([]);
  });
});
