/*
 * Playwright config — Highlighting Utah
 *
 * Serves the repo as static files (which is exactly what Netlify does) and
 * drives the real index.html / admin.html / employee.html in a headless
 * browser, with Firebase faked underneath (tests/firebase-stub.js).
 *
 * FIRST RUN, once, on your machine:
 *     npm install
 *     npx playwright install chromium
 * The second command downloads the browser itself (~150MB). It is separate
 * from npm install on purpose, and only needs doing once per machine.
 *
 * Run:  npm run test:browser          (headless, what CI runs)
 *       npm run test:browser:headed   (watch it happen, for debugging)
 */

const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',

  /* Under 60 seconds total is the budget (CLAUDE.md §9.8). These keep one
   * stuck test from eating it. */
  timeout: 20_000,
  expect: { timeout: 5_000 },

  /* NO RETRIES, deliberately — including in CI. A flaky test is fixed or
   * deleted, never retried into green (CLAUDE.md §9.7). Retries here would
   * hide exactly the instability that rule exists to surface. */
  retries: 0,

  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,

  /* Stop a stray .only() from silently shrinking the suite in CI. */
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,

    /* Fixed viewport. Visual regression (Phase 4) needs this pinned — a
     * different size means every screenshot differs. */
    viewport: { width: 1280, height: 900 },

    /* Evidence only when something fails, so a green run stays fast. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  /* Plain static file server over the repo root — no build step, same as
   * production. reuseExistingServer keeps local re-runs quick. */
  webServer: {
    command: `npx --yes http-server . -p ${PORT} -c-1 --silent`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
