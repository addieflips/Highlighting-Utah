/* Throwaway config for this container ONLY (CLAUDE.md §9.15). The sandbox ships
   chromium-1194; @playwright/test here pins 1234, so every spec dies at launch
   with "Executable doesn't exist". Points at the build that is actually present.
   Absolute testDir and webServer cwd, because both resolve relative to THIS file. */
const { defineConfig, devices } = require('@playwright/test');
const PORT = 4173;
const ROOT = '/home/user/Highlighting-Utah';
module.exports = defineConfig({
  testDir: "/home/user/Highlighting-Utah/test",
  testMatch: '**/*.spec.js',
  timeout: 20000,
  expect: { timeout: 5000 },
  retries: 0,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:' + PORT,
    viewport: { width: 1280, height: 900 },
    trace: 'off', screenshot: 'off', video: 'off',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx --yes http-server . -p ' + PORT + ' -c-1 --silent',
    cwd: ROOT,
    url: 'http://127.0.0.1:' + PORT + '/index.html',
    reuseExistingServer: true,
    timeout: 60000
  }
});
