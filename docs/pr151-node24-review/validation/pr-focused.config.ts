import original from './pr-browser.config';
export default { ...original,
  reporter: [['list'], ['json', { outputFile: '/workspace/pr151-evidence/pr-focused.json' }]],
  outputDir: '/workspace/pr151-evidence/pr-focused-output',
};
