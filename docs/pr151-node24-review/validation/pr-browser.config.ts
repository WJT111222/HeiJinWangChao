import original from '/workspace/pr151-format-tail/playwright.config';
export default {
  ...original,
  testDir: '/workspace/pr151-format-tail/e2e',
  reporter: [['list'], ['json', { outputFile: '/workspace/pr151-evidence/pr-browser.json' }]],
  outputDir: '/workspace/pr151-evidence/pr-browser-output',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5661' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5661 --strictPort', cwd: '/workspace/pr151-format-tail', url: 'http://127.0.0.1:5661', reuseExistingServer: false },
};
