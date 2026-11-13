import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// PR #124 only: explicit allowlist, never the full E2E suite.
const inspector = /无存档浏览真实模块|真实存档六种模式预览|已发送阶段快照|四开关显式保存|四开关取消旧组装/;
export default defineConfig(base, {
  workers: 1,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'docs/pr124-review/chromium-results.json' }]],
  outputDir: 'test-results/pr124',
  use: { ...base.use, reducedMotion: 'reduce', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' } },
  projects: [
    { name: 'desktop', testMatch: 'prompt-inspector.spec.ts', grep: inspector, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', testMatch: 'prompt-inspector.spec.ts', grep: inspector, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'business-desktop', testMatch: ['story-runtime.spec.ts', 'variable-runtime.spec.ts', 'world-runtime.spec.ts', 'memory-maintenance.spec.ts'], grep: /真实开局流式分片|变量正常生成、真实独立路由|世界生成、补算、只读查看|选择并恢复独立模型/, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-dialog', testMatch: 'mobile-batch2.spec.ts', grep: /底部选择器：无匹配/, use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
