import { defineConfig, devices } from '@playwright/test';

const port = 4317;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } }],
  webServer: {
    // The same bundle that ships to production, with quick bots so full games finish fast.
    command: 'node dist/release/server/index.js',
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      STATIC_DIR: 'dist/release/web',
      HG_BOT_DELAY: '40',
      HG_TRICK_PAUSE: '300',
      HG_HAND_SUMMARY: '1500',
      HG_VERSION: 'e2e',
    },
  },
});
