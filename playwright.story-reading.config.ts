import { defineConfig } from '@playwright/test';
import original from './playwright.config';
export default defineConfig({
  ...original,
  reporter: [['list'], ['json', { outputFile: process.env.STORY_READING_RESULT ?? 'test-results/story-stream-reading.json' }]],
  outputDir: 'test-results/story-stream-reading',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5356' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5356 --strictPort', url: 'http://127.0.0.1:5356', reuseExistingServer: false },
});
