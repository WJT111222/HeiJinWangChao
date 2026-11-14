import { defineConfig } from '@playwright/test';
import original from './playwright.config';
export default defineConfig({
  ...original,
  testMatch: 'story-tag-recovery.spec.ts',
  reporter: [['list'], ['json', { outputFile: process.env.PR149_RESULT ?? 'test-results/pr149.json' }]],
  outputDir: 'test-results/pr149',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5374' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5374 --strictPort', url: 'http://127.0.0.1:5374', reuseExistingServer: false },
});
