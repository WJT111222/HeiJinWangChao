import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Dedicated server: never reuse a different worktree's existing Vite process.
const port = Number(process.env.OBSERVATION_PORT ?? 5198);
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
