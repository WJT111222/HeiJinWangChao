import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { runRollbackScenarios } from './support/worldbookRollbackScenarios';

/**
 * 世界书阶段 C 回滚兼容性探测（Vitest + fake-indexeddb）。
 * 同一组场景也在真实 Chromium 中运行：e2e/worldbook-rollback-compat.spec.ts。
 */
it('旧版客户端（当前 main 的存储代码）面对新版可能写入的数据：逐项观察结果符合预期', async () => {
  const observations = await runRollbackScenarios(new IDBFactory(), 'vitest');
  const failed = observations.filter((o) => !o.pass);
  expect(failed).toEqual([]);
  expect(observations.length).toBeGreaterThan(30);
});
