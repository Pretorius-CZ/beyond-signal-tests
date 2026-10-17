import { defineConfig, devices } from '@playwright/test';

// BASE_URL: which version of the game to test (default: the live site with the bot UTM tag).
// PROJECTS: comma-separated device names to run (default: all), e.g. used by the full playthrough.
// FULL_BROWSERS=1: iPhones/iPads run in real WebKit (Safari engine), as in GitHub Actions.
const real = process.env.FULL_BROWSERS === '1';
const chromiumPath = process.env.CHROMIUM_PATH;
const as = (device, engine) => ({
  ...devices[device],
  ...(real ? { browserName: engine } : { browserName: 'chromium', ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}) }),
});

export default defineConfig({
  testDir: './tests',
  // SUITE picks the check: playthrough (default), chaos, czech, perf, a11y, visual
  testMatch: `${process.env.SUITE || 'playthrough'}.spec.js`,
  timeout: Number(process.env.TIMEOUT_MIN || (process.env.LEVELS === 'all' ? 330 : 15)) * 60 * 1000,
  fullyParallel: true,
  workers: process.env.WORKERS ? Number(process.env.WORKERS) : 4,
  retries: 0,
  outputDir: 'reports/artifacts',
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright', open: 'never' }]],
  use: {
    // UTM tag: bot visits show up as their own campaign in balance.html.
    baseURL: process.env.BASE_URL || 'https://playbeyondthesignal.com/?utm_source=automated_test&utm_medium=bot&utm_campaign=qa_01',
    reducedMotion: 'reduce', // shorter animations = faster bots (game honours prefers-reduced-motion)
    // A full playthrough lasts hours: no video/trace there, it would be gigabytes.
    trace: process.env.LEVELS === 'all' ? 'off' : 'retain-on-failure',
    video: process.env.VIDEO === '1' ? 'on' : process.env.LEVELS === 'all' ? 'off' : 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    { name: 'iPhone SE (malý telefon)', use: as('iPhone SE', 'webkit') },
    { name: 'iPhone 15 Pro Max', use: as('iPhone 15 Pro Max', 'webkit') },
    { name: 'Pixel 7 (Android)', use: as('Pixel 7', 'chromium') },
    { name: 'Galaxy S9+ (Android)', use: as('Galaxy S9+', 'chromium') },
    { name: 'Telefon na šířku', use: as('Pixel 7 landscape', 'chromium') },
    { name: 'iPad Mini', use: as('iPad Mini', 'webkit') },
    { name: 'Notebook 1366×768', use: { ...as('Desktop Chrome', 'chromium'), viewport: { width: 1366, height: 768 } } },
    { name: 'Desktop 1920×1080', use: { ...as('Desktop Chrome', 'chromium'), viewport: { width: 1920, height: 1080 } } },
    ...(real ? [{ name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } }] : []),
  ],
});
