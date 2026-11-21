import { expect, test } from '@playwright/test';

/**
 * 世界书触发 Worker（真实 Chromium + Vite 开发服务器 + 真实 Worker + 真实 IndexedDB）。
 * 书装进本地书库，由 Worker 读取并触发：确定性、超时与取消真正终止计算、主线程保持响应、重建、缺失版本。
 * 每个测试是独立的浏览器上下文，书库只在其中创建。
 */
test('触发 Worker：确定性、超时、取消、主线程响应、重建', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const observations = await page.evaluate(async () => {
    const scenarios = '/src/tests/support/worldbookWorkerScenarios.ts';
    const { runWorkerScenarios } = await import(scenarios);
    return runWorkerScenarios();
  }) as Array<{ name: string; value: unknown }>;
  await info.attach('worker-observations.json', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
  console.log(`WORKER ${info.project.name} ${JSON.stringify(observations)}`);
  const get = (name: string) => observations.find((o) => o.name === name)?.value as Record<string, unknown> | boolean | string | undefined;
  expect(get('确定性')).toBe(true);
  const timed = get('超时') as { status: string; ms: number; ticks: number };
  expect(timed.status).toBe('timeout');
  expect(timed.ms).toBeLessThan(1_000);
  expect(timed.ticks).toBeGreaterThanOrEqual(5); // 计算期间主线程照常响应定时器
  const cancelled = get('取消') as { status: string; ms: number };
  expect(cancelled.status).toBe('cancelled');
  expect(cancelled.ms).toBeLessThan(1_000);
  expect(get('重建后结果不变')).toBe(true);
  const full = get('大书在 Worker 中完成') as { status: string; ticks: number; ms: number; limit: number };
  expect(full.status).toBe('ok');
  expect(full.limit).toBe(500_000_000);
  expect(full.ticks).toBeGreaterThanOrEqual(Math.floor(full.ms / 100)); // 至少每 100 毫秒能响应一次
  expect(get('缺失版本')).toBe('missing_version');
});
