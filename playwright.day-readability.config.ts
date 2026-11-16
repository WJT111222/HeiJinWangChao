import { defineConfig, devices } from '@playwright/test';
const regression = process.env.READABILITY_REGRESSION === '1';
const prior = /automatic invalid_output|待生成、无 Web Locks/;
const port = Number(process.env.READABILITY_PORT ?? 55325);
export default defineConfig({
  testDir: './e2e', testMatch: regression ? ['mobile-info-sheets.spec.ts', 'stage-failure-summary.spec.ts'] : ['day-readability.spec.ts', 'day-appearance.spec.ts'], workers: 2, retries: 0, timeout: 60000,
  reporter: [['list'], ['json', { outputFile: process.env.READABILITY_REPORT ?? 'test-results/day-readability/results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' } },
  projects: [{ name: 'desktop', grep: regression ? prior : undefined, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', grep: regression ? /automatic invalid_output|待生成、无 Web Locks|手机: 人物上拉|手机: 世界目录/ : undefined, use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }],
  webServer: [{ cwd: process.env.READABILITY_BASELINE_DIR ?? '../pr165-readability-before', command: 'npm run dev -- --host 127.0.0.1 --port 55324 --strictPort', url: 'http://127.0.0.1:55324', reuseExistingServer: false }, { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false }],
});
