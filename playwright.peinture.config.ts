import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Run against dist/ after npm run build. No development modules are served.
export default defineConfig({
  ...base,
  testMatch: '**/peinture-settings.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5196' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5196 --strictPort',
    url: 'http://127.0.0.1:5196',
    reuseExistingServer: false,
  },
});
