import original from './main-browser.config';
export default { ...original,
  reporter: [['list'], ['json', { outputFile: '/workspace/pr151-evidence/main-focused.json' }]],
  outputDir: '/workspace/pr151-evidence/main-focused-output',
};
