import { defineConfig } from '@playwright/test';

// Only the two cross-version IndexedDB scenarios. No full game E2E run.
export default defineConfig({
  testDir: './e2e', testMatch: 'save-backup-upgrade.spec.ts', workers: 1, retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/backup-upgrade-results.json' }]],
  outputDir: 'test-results/backup-upgrade',
  use: { baseURL: 'http://127.0.0.1:5291', browserName: 'chromium', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5291 --strictPort',
    url: 'http://127.0.0.1:5291', reuseExistingServer: false },
});
