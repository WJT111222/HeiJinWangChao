import original from '/workspace/pr150-story-tag-repair/playwright.config';
export default {
  ...original,
  testDir: '/workspace/pr150-story-tag-repair/e2e',
  reporter: [['list'], ['json', { outputFile: '/workspace/pr150-evidence/pr-runtime.json' }]],
  outputDir: '/workspace/pr150-evidence/pr-runtime-output',
  use: { ...original.use, baseURL: 'http://127.0.0.1:5531' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5531 --strictPort', cwd: '/workspace/pr150-story-tag-repair', url: 'http://127.0.0.1:5531', reuseExistingServer: false },
};
