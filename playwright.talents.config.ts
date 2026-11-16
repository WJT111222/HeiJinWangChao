import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Own port/server prevents another stacked worktree from serving stale UI.
export default defineConfig({
  ...base,
  testMatch: ['opening-talents-ui.spec.ts', 'character-creation-v2.spec.ts'],
  outputDir: process.env.TALENT_UI_RESULTS ?? 'test-results/talents',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5188' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5188 --strictPort',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: false,
  },
});
