import { afterEach, expect, it, vi } from 'vitest';
import { budgetAnalysis, cancelBudgetAnalyses } from '../prompts/budgetAnalysis';
import { inspectBudget } from '../prompts/budgetInspection';
import type { AiMessage } from '../services/ai/protocols';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: URL, public options: WorkerOptions) { ControlledWorker.instances.push(this); }
  reply(result: ReturnType<typeof inspectBudget>) { this.onmessage?.({ data: { ok: true, result } } as MessageEvent); }
}
const messages = (): AiMessage[] => [{ role: 'user', content: '<GAME_CONTEXT>{"SAVE_STATE":{"npc":{"one":{"id":"one","name":"人物🙂","onScene":true}}},"SCENE_NPCS":[{"id":"one","name":"人物🙂","onScene":true}],"MEMORY_CONTEXT":{"recalledTurns":[{"turnId":"t","relevance":"strong","narrativeExcerpt":"旧史","narrativeTruncated":true}],"recallDiagnostics":{"budgetCharacters":99}}}</GAME_CONTEXT>' }];
afterEach(() => { cancelBudgetAnalyses(); vi.unstubAllGlobals(); ControlledWorker.instances = []; });

it('仅显式按需创建专用模块 Worker，完成后缓存且不再次启动', () => {
  vi.stubGlobal('Worker', ControlledWorker);
  const source = messages(), before = structuredClone(source), analysis = budgetAnalysis(source);
  expect(analysis.getSnapshot()).toEqual({ status: 'idle' });
  expect(ControlledWorker.instances).toHaveLength(0);
  analysis.start(); analysis.start();
  const worker = ControlledWorker.instances[0];
  expect(worker.options).toEqual({ type: 'module' });
  expect(worker.url.pathname).toMatch(/budgetInspection.worker.ts$/);
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(source);
  expect(analysis.getSnapshot()).toEqual({ status: 'running' });
  const result = inspectBudget(source);
  worker.reply(result);
  expect(analysis.getSnapshot()).toEqual({ status: 'complete', result });
  expect(result.reconciliation).toMatchObject({ characters: 0, bytes: 0 });
  expect(result.duplicates.some(row => row.identity === 'npc:one')).toBe(true);
  expect(result.recall).toMatchObject({ strong: 1, truncated: 1 });
  analysis.start();
  expect(budgetAnalysis(source)).toBe(analysis);
  expect(ControlledWorker.instances).toHaveLength(1);
  expect(source).toEqual(before);
});

it('取消/切换/清空丢弃旧回复，重开可启动；不同请求缓存相互隔离', () => {
  vi.stubGlobal('Worker', ControlledWorker);
  const a = budgetAnalysis(messages()), b = budgetAnalysis(messages());
  a.start(); const old = ControlledWorker.instances[0];
  a.cancel(); b.start();
  old.reply(inspectBudget(messages()));
  expect(a.getSnapshot()).toEqual({ status: 'idle' });
  expect(b.getSnapshot()).toEqual({ status: 'running' });
  a.start(); const next = ControlledWorker.instances[2];
  old.reply(inspectBudget(messages()));
  expect(a.getSnapshot()).toEqual({ status: 'running' });
  cancelBudgetAnalyses(); next.reply(inspectBudget(messages()));
  expect(a.getSnapshot()).toEqual({ status: 'idle' });
  expect(b.getSnapshot()).toEqual({ status: 'idle' });
  expect(old.terminate).toHaveBeenCalledOnce();
});

it('Worker 缺失、启动或传递失败显式不可用，无主线程分析回退', () => {
  vi.stubGlobal('Worker', undefined);
  const analysis = budgetAnalysis(messages()); analysis.start();
  expect(analysis.getSnapshot()).toEqual({ status: 'unavailable' });
  vi.stubGlobal('Worker', class { constructor() { throw Error('blocked'); } });
  analysis.start(); expect(analysis.getSnapshot()).toEqual({ status: 'unavailable' });
  vi.stubGlobal('Worker', class extends ControlledWorker { postMessage = vi.fn(() => { throw Error('clone'); }); });
  analysis.start(); expect(analysis.getSnapshot()).toEqual({ status: 'unavailable' });
});

it.each(['onerror', 'onmessageerror'] as const)('%s 不改变快照，失败后可重试', (event) => {
  vi.stubGlobal('Worker', ControlledWorker);
  const source = messages(), before = structuredClone(source), analysis = budgetAnalysis(source);
  analysis.start(); ControlledWorker.instances[0][event]?.();
  expect(analysis.getSnapshot()).toEqual({ status: 'failed' });
  expect(source).toEqual(before);
  analysis.start(); expect(analysis.getSnapshot()).toEqual({ status: 'running' });
});
