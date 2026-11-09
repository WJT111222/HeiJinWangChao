import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { SaveRepository } from '../services/storage/saveRepository';
import { MemoryMaintenance } from '../workflows/memoryMaintenance';
import { MemorySummaryQueue } from '../workflows/memorySummaryQueue';
import type { SummaryFailure } from '../workflows/memorySummaryQueue';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import type { SummaryKind } from '../domain/memories/configuration';
import { compressionState } from './fixtures/compression';
import { npcMemoryState } from './fixtures/npcMemory';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';

const repositories: SaveRepository[] = [];
afterEach(() => { repositories.splice(0).forEach(repo => repo.close()); vi.restoreAllMocks(); });
async function harness(kind: SummaryKind = 'short') {
  const factory = new IDBFactory(), repo = await SaveRepository.open('summary-undo', factory);
  repositories.push(repo);
  const state = compressionState('short', 90); state.npc = npcMemoryState(60).npc;
  await new Promise<void>((resolve, reject) => {
    const open = factory.open('summary-undo'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('saves', 'readwrite'); tx.objectStore('saves').put(state);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); }; };
  });
  const draft = await completeDraft(repo, { variables: await elapsedVariables(repo, '新的一分钟', 60) });
  await repo.commitTurn(submission(draft, ''));
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const settings = defaultSettings();
  for (const entry of Object.values(settings.memory.summaries)) entry.automatic = false;
  settings.memory.summaries[kind].automatic = true;
  const config = defaultAiConfig(), channel = newChannel(); config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'mock' };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'mock-undo-summary-key');
  const control = { hold: undefined as Promise<void> | undefined, status: 200 };
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages as { role: string; content: string }[];
    const content = messages.find(message => message.role === 'user')!.content;
    const task = JSON.parse(content.slice('<GAME_CONTEXT>\n'.length, -'\n</GAME_CONTEXT>'.length)).MEMORY_TASK;
    await control.hold;
    return control.status === 200 ? Response.json({ choices: [{ message: { content: JSON.stringify(task.groups
      ? { summaries: task.groups.map((group: { groupId: string }) => ({ groupId: group.groupId, text: '他回顾了这些经历与未完的约定。' })), unresolved: [], contradictions: [] }
      : { summary: '这些经历已被整理。', importantEvents: ['保留原来的约定与后续变化。'] }) } }] })
      : new Response('', { status: control.status });
  });
  const runner = new MemoryMaintenance(repo, new AiClient(transport), async (_id, work) => work());
  const failures = { current: [] as SummaryFailure[] };
  const execute = vi.fn(async (selected: SummaryKind, immediate: boolean, npcId?: string) => {
    await runner.run({ saveId: state.saveId, config, vault, timeoutSeconds: 10, kind: selected, immediate, npcId,
      automatic: !immediate, attempts: storage, summaryConfig: settings.memory.summaries[selected] });
  });
  const queue = (repository = repo) => new MemorySummaryQueue({ saveId: state.saveId, storage, settings: () => settings,
    load: () => repository.load(state.saveId), execute, changed: next => { failures.current = next; } });
  const undo = async () => {
    const game = await repo.loadGame(state.saveId);
    return repo.undoTurn({ saveId: state.saveId, expectedRevision: game.state.revision, expectedDraft: game.draft, operationId: crypto.randomUUID() });
  };
  const send = async () => { const game = await repo.loadGame(state.saveId); await repo.bindTurnAction(game.draft!, '明确发送新行动', true, true); };
  return { repo, factory, state, storage, settings, control, transport, runner, failures, execute, queue, undo, send,
    attemptKey: `heijin.summary.attempt:${state.saveId}:${state.createdAt}:${kind}`,
    rateKey: `heijin.summary.rate:${state.saveId}:${state.createdAt}` };
}

it.each(['short', 'npc'] as const)('%s 在飞行中撤回：刷新明确待确认，发送不授权重试，手动成功后才自动恢复', async kind => {
  const h = await harness(kind), oldQueue = h.queue();
  let release!: () => void; h.control.hold = new Promise(resolve => { release = resolve; });
  const pending = oldQueue.wake(); await vi.waitFor(() => expect(h.transport).toHaveBeenCalledTimes(1));
  const marker = h.storage.getItem(h.attemptKey), rate = h.storage.getItem(h.rateKey);
  expect(marker).toBeTruthy(); const restored = await h.undo(); oldQueue.stop(); release(); await pending;
  expect(await h.repo.load('save-a')).toEqual(restored.state);
  expect(h.storage.getItem(h.attemptKey)).toBe(marker); expect(h.storage.getItem(h.rateKey)).toBe(rate);
  const reopened = await SaveRepository.open('summary-undo', h.factory); repositories.push(reopened);
  const queue = h.queue(reopened); await queue.wake();
  expect(h.failures.current).toEqual([expect.objectContaining({ kind, code: 'MEMORY_PREVIOUS',
    message: expect.stringContaining('发送行动不会自动重试') })]);
  expect(h.transport).toHaveBeenCalledTimes(1);
  await h.send(); await queue.wake(); await queue.wake();
  expect(h.transport).toHaveBeenCalledTimes(1); expect(h.storage.getItem(h.attemptKey)).toBe(marker);
  await queue.immediate(kind, kind === 'npc' ? 'npc-a' : undefined);
  expect(h.transport).toHaveBeenCalledTimes(2); expect(h.storage.getItem(h.attemptKey)).toBe('');
  expect(h.failures.current).toEqual([]); expect(h.storage.getItem(h.rateKey)).toBe(rate);
  const saved = await h.repo.load('save-a');
  expect(kind === 'npc' ? saved.memories.npcSummaries['npc-a'].length : saved.memories.medium.length).toBe(1);
  expect(saved.npc).toEqual(restored.state.npc); expect(saved.journal).toEqual(restored.state.journal);
  await queue.wake(); expect(h.transport).toHaveBeenCalledTimes(3);
  expect(JSON.parse(h.storage.getItem(h.rateKey)!)).toHaveLength(2);
});

it.each([401, 503])('HTTP %s 真实失败即使撤回、刷新、发送也不能清除收费失败记录', async status => {
  const h = await harness(); h.control.status = status;
  await h.queue().wake(); expect(h.transport).toHaveBeenCalledTimes(1);
  const marker = h.storage.getItem(h.attemptKey), rate = h.storage.getItem(h.rateKey);
  await h.undo(); const queue = h.queue(); await queue.wake(); await h.send(); await queue.wake();
  expect(h.transport).toHaveBeenCalledTimes(1); expect(h.storage.getItem(h.attemptKey)).toBe(marker);
  expect(h.storage.getItem(h.rateKey)).toBe(rate); expect(h.failures.current).toHaveLength(1);
  h.control.status = 200; await queue.immediate('short'); expect(h.transport).toHaveBeenCalledTimes(2);
});

it('撤回取消与新时间线的真实失败分别保留，旧结果不能清掉新的失败', async () => {
  const h = await harness(), old = h.queue(); let release!: () => void;
  h.control.hold = new Promise(resolve => { release = resolve; });
  const pending = old.wake(); await vi.waitFor(() => expect(h.transport).toHaveBeenCalledTimes(1));
  h.runner.cancel(); const restored = await h.undo(); old.stop(); release(); await pending;
  expect(await h.repo.load('save-a')).toEqual(restored.state);
  await h.send(); const queue = h.queue(); await queue.wake(); expect(h.transport).toHaveBeenCalledTimes(1);
  h.control.status = 503; await queue.immediate('short'); expect(h.transport).toHaveBeenCalledTimes(2);
  const marker = h.storage.getItem(h.attemptKey); await queue.wake(); await h.queue().wake();
  expect(h.transport).toHaveBeenCalledTimes(2); expect(h.storage.getItem(h.attemptKey)).toBe(marker);
  expect(h.failures.current).toHaveLength(1);
});

it.each(['minute', 'hour'] as const)('%s 限流包括撤回前已发请求，手动处理不会重置台账', async window => {
  const h = await harness(), now = Date.now();
  const prior = Array.from({ length: window === 'minute' ? 2 : 11 }, (_, index) => now - (window === 'minute' ? 1000 : 120000) - index);
  h.storage.setItem(h.rateKey, JSON.stringify(prior));
  h.control.status = 503; await h.queue().wake(); expect(h.transport).toHaveBeenCalledTimes(1);
  const rate = h.storage.getItem(h.rateKey); expect(JSON.parse(rate!)).toHaveLength(prior.length + 1);
  await h.undo(); await h.send(); const queue = h.queue(); await queue.wake();
  h.control.status = 200; await queue.immediate('short'); expect(h.transport).toHaveBeenCalledTimes(2);
  await queue.wake(); expect(h.transport).toHaveBeenCalledTimes(2); expect(h.storage.getItem(h.rateKey)).toBe(rate);
});

it('自动关闭不被撤回或手动处理重新开启，其他总结类型仍可独立工作', async () => {
  const h = await harness(); h.control.status = 503; await h.queue().wake(); await h.undo();
  h.settings.memory.summaries.short.automatic = false; h.settings.memory.summaries.npc.automatic = true;
  await h.send(); h.control.status = 200; const queue = h.queue(); await queue.wake();
  expect(h.transport).toHaveBeenCalledTimes(2); expect((await h.repo.load('save-a')).memories.npcSummaries['npc-a']).toHaveLength(1);
  expect(h.storage.getItem(h.attemptKey)).toBeTruthy();
  await queue.immediate('short'); expect(h.transport).toHaveBeenCalledTimes(3);
  h.settings.memory.summaries.npc.automatic = false; await queue.wake();
  expect(h.transport).toHaveBeenCalledTimes(3); expect(h.settings.memory.summaries.short.automatic).toBe(false);
});

it('已保存但本地确认失败：仅正式快照仍含该结果时恢复确认，不重复总结原来源', async () => {
  const h = await harness(), set = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key === h.attemptKey && !value) throw new Error('mock acknowledgement interrupted'); set(key, value); };
  await h.queue().wake(); expect(h.transport).toHaveBeenCalledTimes(1);
  const saved = await h.repo.load('save-a'), marker = h.storage.getItem(h.attemptKey);
  expect(saved.memories.medium[0].id).toBe(marker);
  // A subsequent real commit captures the successfully saved summary.
  const draft = await completeDraft(h.repo, { variables: await elapsedVariables(h.repo, '继续一回合', 60) });
  await h.repo.commitTurn(submission(draft, '')); await h.undo();
  h.storage.setItem = set; const queue = h.queue(); await queue.wake();
  expect(h.storage.getItem(h.attemptKey)).toBe(''); expect(h.failures.current).toEqual([]);
  expect(h.transport).toHaveBeenCalledTimes(1); // Undo still pauses new automatic work.
  await h.send(); await queue.wake(); expect(h.transport).toHaveBeenCalledTimes(2);
  const entries = (await h.repo.load('save-a')).memories.medium;
  const sources = entries.flatMap(entry => entry.sourceTurnIds);
  expect(new Set(sources).size).toBe(sources.length); expect(entries[0]).toEqual(saved.memories.medium[0]);
});

it('已保存但确认失败的结果被撤回移除后，不拿旧成功当新时间线的付费许可', async () => {
  const h = await harness(), set = h.storage.setItem;
  h.storage.setItem = (key, value) => { if (key === h.attemptKey && !value) throw new Error('mock acknowledgement interrupted'); set(key, value); };
  await h.queue().wake(); const marker = h.storage.getItem(h.attemptKey);
  await h.undo(); h.storage.setItem = set; await h.send(); await h.queue().wake();
  expect(h.transport).toHaveBeenCalledTimes(1); expect(h.storage.getItem(h.attemptKey)).toBe(marker);
  expect((await h.repo.load('save-a')).memories.medium).toEqual([]);
});
