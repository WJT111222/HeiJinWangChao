import { expect, test } from '@playwright/test';

/**
 * 世界书阶段 C 回滚兼容性探测（真实 Chromium + Vite 开发服务器）。
 * 在页面里直接加载当前代码的存储模块（= main@a820f5e，本分支未改动存储代码），
 * 使用浏览器真实的 IndexedDB 与历史压缩 Worker。数据库名带随机前缀，只在这个隔离的浏览器上下文中创建。
 * 原始观察结果写入测试附件 compat-observations.json。
 */
test('旧版客户端面对新版可能写入的数据：逐项观察', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const observations = await page.evaluate(async (prefix) => {
    const scenarios = '/src/tests/support/worldbookRollbackScenarios.ts';
    const { runRollbackScenarios } = await import(scenarios);
    return runRollbackScenarios(indexedDB, prefix);
  }, `e2e-${info.project.name}-${Date.now()}`) as Array<{ scenario: string; operation: string; result: string; expected: string; pass: boolean }>;
  await info.attach('compat-observations.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
  console.log(`COMPAT ${info.project.name} ${JSON.stringify(observations)}`);
  expect(observations.filter((o) => !o.pass)).toEqual([]);
  expect(observations.length).toBeGreaterThan(30);
});
