import original from '/workspace/pr151-main-baseline/playwright.config';
export default {
  ...original,
  testDir: '/workspace/pr151-main-baseline/e2e',
  reporter: [['list'], ['json', { outputFile: '/workspace/pr151-evidence/main-browser.json' }]],
  outputDir: '/workspace/pr151-evidence/main-browser-output',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5662' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5662 --strictPort', cwd: '/workspace/pr151-main-baseline', url: 'http://127.0.0.1:5662', reuseExistingServer: false },
};
