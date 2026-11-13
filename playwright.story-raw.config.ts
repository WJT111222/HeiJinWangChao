import { defineConfig } from '@playwright/test';
import original from './playwright.config';
export default defineConfig({
  ...original,
  testMatch: 'story-raw-continuous.spec.ts',
  reporter: [['list'], ['json', { outputFile: process.env.STORY_RAW_RESULT ?? 'test-results/story-raw-continuous.json' }]],
  outputDir: 'test-results/story-raw-continuous',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5368' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5368 --strictPort', url: 'http://127.0.0.1:5368', reuseExistingServer: false },
});
