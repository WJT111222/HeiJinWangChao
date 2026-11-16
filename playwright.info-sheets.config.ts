import { defineConfig } from '@playwright/test';
const regression = process.env.SHEET_REGRESSION === '1';
const regressionTitles = /抽屉：Tab 环|长正文、完整状态与金额|真实触屏：长内容|正常动效：抽屉|原生内层手势、遮罩|手机选择抽屉|reasoning-only failure/;
const port = Number(process.env.SHEET_PORT ?? 54151);
const chromium = { browserName: 'chromium' as const, launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' } };
export default defineConfig({
  reporter: [['list'], ['json', { outputFile: process.env.SHEET_REPORT ?? 'test-results/info-sheets/results.json' }]],
  testDir: './e2e', testMatch: regression ? ['mobile-main-batch1.spec.ts', 'mobile-archives.spec.ts', 'mobile-select-sheet.spec.ts', 'stage-response-observation.spec.ts'] : 'mobile-info-sheets.spec.ts', workers: 2, retries: 0, timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: regression ? [{ name: 'mobile', grep: regressionTitles, use: { ...chromium, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }] : process.env.SHEET_WEBKIT === '1' ? [{ name: 'webkit-390', grep: /手机:/,
    use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }]
    : [
      ...[[375, 667], [390, 844], [430, 932]].map(([width, height]) => ({ name: `chromium-${width}`, grep: /手机:/,
        use: { ...chromium, viewport: { width, height }, isMobile: true, hasTouch: true } })),
      ...[901, 1440].map(width => ({ name: `desktop-${width}`, grep: /PC:/, use: { ...chromium, viewport: { width, height: 900 } } })),
    ],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
