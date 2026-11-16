import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.PR165_PORT ?? 55329);
export default defineConfig({
  testDir: './e2e', testMatch: 'day-appearance-integration.spec.ts', workers: 2, retries: 0, timeout: 45000,
  reporter: [['list'], ['json', { outputFile: process.env.PR165_REPORT ?? 'test-results/pr165-integration/results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
