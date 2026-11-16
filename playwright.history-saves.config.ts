import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'history-saves.spec.ts', workers: 2, fullyParallel: true, retries: 0,
  timeout: 60000, expect: { timeout: 10000 },
  outputDir: process.env.HISTORY_EVIDENCE_DIR ?? 'test-results/history-saves',
  use: { baseURL: 'http://127.0.0.1:5291', trace: 'retain-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5291 --strictPort', url: 'http://127.0.0.1:5291', reuseExistingServer: false },
});
