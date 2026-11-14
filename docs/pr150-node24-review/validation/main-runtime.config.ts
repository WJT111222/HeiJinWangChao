import original from '/workspace/pr150-main-baseline/playwright.config';
export default {
  ...original,
  testDir: '/workspace/pr150-main-baseline/e2e',
  reporter: [['list'], ['json', { outputFile: '/workspace/pr150-evidence/main-runtime.json' }]],
  outputDir: '/workspace/pr150-evidence/main-runtime-output',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5532' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5532 --strictPort', cwd: '/workspace/pr150-main-baseline', url: 'http://127.0.0.1:5532', reuseExistingServer: false },
};
