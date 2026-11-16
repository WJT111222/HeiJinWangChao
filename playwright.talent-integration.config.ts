import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Dedicated server prevents another worktree from being mistaken for the integration.
export default defineConfig({
  ...base,
  testMatch: ['opening-talents-ui.spec.ts', 'character-creation-v2.spec.ts', 'day-appearance.spec.ts', 'day-dialog-contrast.spec.ts'],
  outputDir: process.env.TALENT_INTEGRATION_RESULTS ?? 'test-results/talent-integration',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5189' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort', url: 'http://127.0.0.1:5189', reuseExistingServer: false },
});
