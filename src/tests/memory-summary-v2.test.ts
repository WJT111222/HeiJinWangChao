import { expect, it } from 'vitest';
import { planNpcSummary, parseNpcSummary, applyNpcSummary, npcSummaryCandidates } from '../domain/memories/npcMemory';
import { planCompression } from '../domain/memories/compression';
import { npcMemoryState, npcSummaryOutput } from './fixtures/npcMemory';
import { compressionState } from './fixtures/compression';
it('NPC在20条触发，准确处理15条且保留全部原始来源和5条活跃记忆', () => {
  const state = npcMemoryState(20), batch = planNpcSummary(state, 'npc-a');
  expect(batch?.entries).toHaveLength(15);
  const result = parseNpcSummary(JSON.stringify(npcSummaryOutput(batch!)), batch!, 'v2');
  const after = applyNpcSummary(state, batch!, result);
  expect(after.npc).toEqual(state.npc);
  expect(npcSummaryCandidates(after, 'npc-a')).toHaveLength(5);
});
it('完整公共批次超预算时整批失败，不能默默改小', () => {
  const state = compressionState();
  state.memories.short.forEach(entry => { entry.text = '完整的真实历史'.repeat(300); });
  expect(() => planCompression(state)).toThrow();
});

import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { defaultSummaryConfig, SummaryConfigSchema } from '../domain/memories/configuration';
import { MemorySummaryQueue } from '../workflows/memorySummaryQueue';
import { MemoryMaintenance } from '../workflows/memoryMaintenance';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { applyCompression, parseCompression } from '../domain/memories/compression';
import { describe, vi } from 'vitest';
const store = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); } }; };
const publicOutput = { summary: '这段时期的经历与关系发生了变化。', importantEvents: ['游戏内记录的一个重要约定及其后续。'] };
function setupRuntime(state = compressionState('short', 100), response = () => Response.json({ choices: [{ message: { content: JSON.stringify(publicOutput) } }] })) {
  let current = structuredClone(state);
  const storage = store(), config = defaultAiConfig(), channel = newChannel();
  channel.defaultModel = 'memory-only'; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.memory = { mode: 'independent', channelId: channel.id, modelId: 'memory-only' };
  const session = { ...storage, removeItem: (key: string) => storage.setItem(key, '') }, vault = new CredentialVault(session, session); vault.set(channel.id, 'mock-secret-v2');
  const transport = vi.fn<typeof fetch>(async () => response());
  const repository = { load: async () => structuredClone(current),
    saveMemoryCompression: async (batch: Parameters<typeof applyCompression>[1], result: Parameters<typeof applyCompression>[2]) => { current = applyCompression(current, batch, result); return current; },
    saveNpcSummary: async (batch: Parameters<typeof applyNpcSummary>[1], result: Parameters<typeof applyNpcSummary>[2]) => { current = applyNpcSummary(current, batch, result); return current; } };
  const runner = new MemoryMaintenance(repository, new AiClient(transport), async (_id, work) => work());
  return { transport, config, vault, storage, runner, repository, current: () => current };
}
describe('独立配置与冻结动态批次', () => {
  it('默认三类自动开启、旧自动关闭安全延续、旧总开关关闭迁移且不再保存 enabled', () => {
    const settings = defaultSettings();
    expect(Object.values(settings.memory.summaries).every(value => value.automatic)).toBe(true);
    const old = SettingsSchema.parse({ ...settings, memory: { immediateWindowSize: 7, automaticMaintenance: false } });
    expect(Object.values(old.memory.summaries).every(value => !value.automatic)).toBe(true);
    expect(old.memory.immediateWindowSize).toBe(7);
    const untouched = SettingsSchema.parse({ ...settings, memory: { immediateWindowSize: 7 } });
    expect(untouched.memory.summaries.npc).toEqual(defaultSummaryConfig('npc'));
    const oldSwitch = SettingsSchema.parse({ ...settings, memory: { ...settings.memory, summaries: {
      ...settings.memory.summaries,
      npc: { ...settings.memory.summaries.npc, enabled: false, automatic: true },
      medium: { ...settings.memory.summaries.medium, enabled: true, automatic: false },
    } } });
    expect(oldSwitch.memory.summaries.short.automatic).toBe(true);
    expect(oldSwitch.memory.summaries.npc.automatic).toBe(false);
    expect(oldSwitch.memory.summaries.medium.automatic).toBe(false);
    expect(Object.hasOwn(oldSwitch.memory.summaries.npc, 'enabled')).toBe(false);
    const restored = SettingsSchema.parse(JSON.parse(JSON.stringify(oldSwitch)));
    expect(restored.memory.summaries.npc.automatic).toBe(false);
    expect(SummaryConfigSchema.safeParse({ ...defaultSummaryConfig('short'), minimumEvents: 5 }).success).toBe(false);
  });
  it('NPC25/18及下一轮20/15，配置变更不使旧总结非法', () => {
    const state = npcMemoryState(25), config = { ...defaultSummaryConfig('npc'), threshold: 25, batchSize: 18 };
    const batch = planNpcSummary(state, 'npc-a', { config })!;
    expect(batch.entries).toHaveLength(18);
    const after = applyNpcSummary(state, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'eighteen'));
    expect(npcSummaryCandidates(after, 'npc-a')).toHaveLength(7);
    expect(planNpcSummary(after, 'npc-a', { config: defaultSummaryConfig('npc') })).toBeUndefined();
    expect(() => applyNpcSummary(after, batch, parseNpcSummary(JSON.stringify(npcSummaryOutput(batch)), batch, 'replay'))).toThrow();
    const twenty = npcMemoryState(20), first = planNpcSummary(twenty, 'npc-a')!;
    const saved = applyNpcSummary(twenty, first, parseNpcSummary(JSON.stringify(npcSummaryOutput(first)), first, 'first'));
    for (let index = 0; index < 15; index++) saved.npc['npc-a'].memories.push({ ...twenty.npc['npc-a'].memories[19], id: `new-${index}`, createdAtGameTime: saved.worldClock });
    const next = planNpcSummary(saved, 'npc-a')!;
    expect(next.entries).toHaveLength(15); expect(next.entries.some(entry => first.entries.some(old => old.id === entry.id))).toBe(false);
  });
  it('公共18条完整批次、结构必需但不审查提示词所写的字数或事件数', () => {
    const state = compressionState('short', 40), config = { ...defaultSummaryConfig('short'), batchSize: 18, prompt: '至少9000字，至少99条重要事件。' };
    const batch = planCompression(state, { layer: 'short', config })!;
    expect(batch.entries).toHaveLength(18);
    const result = parseCompression(JSON.stringify(publicOutput), batch, 'structured');
    expect(result.text).toContain('阶段概括'); expect(result.text).toContain('重要事件');
    for (const text of ['{}', '{', ' ', JSON.stringify({ summary: '概括' }), JSON.stringify({ summary: '', importantEvents: ['事'] }), JSON.stringify({ summary: '概括', importantEvents: [] })])
      expect(() => parseCompression(text, batch, 'bad')).toThrow();
    expect(applyCompression(state, batch, result).revision).toBe(state.revision);
  });
  it('立即模式只绕过阈值，自动关闭仍能完整手动总结', () => {
    expect(planCompression(compressionState('short', 18), { layer: 'short', config: defaultSummaryConfig('short'), immediate: true })!.entries).toHaveLength(10);
    expect(planCompression(compressionState('short', 7), { layer: 'short', config: defaultSummaryConfig('short'), immediate: true })).toBeUndefined();
    expect(planNpcSummary(npcMemoryState(18), 'npc-a', { immediate: true })!.entries).toHaveLength(15);
    expect(planNpcSummary(npcMemoryState(12), 'npc-a', { immediate: true })).toBeUndefined();
    expect(planNpcSummary(npcMemoryState(18), 'npc-a', { config: { ...defaultSummaryConfig('npc'), automatic: false }, immediate: true })!.entries).toHaveLength(15);
    expect(planCompression(compressionState('short', 18), { layer: 'short', config: { ...defaultSummaryConfig('short'), automatic: false }, immediate: true })!.entries).toHaveLength(10);
  });
});
describe('真实Memory请求与节流、失败持久化', () => {
  it('使用冻结的独立玩家提示词和固定机器协议，按18条生成保存', async () => {
    const a = setupRuntime(); const config = { ...defaultSummaryConfig('short'), batchSize: 18, prompt: '独立玩家提示词标记，不解析字数12345。' };
    await a.runner.run({ saveId: 'save-a', ...a, kind: 'short', summaryConfig: config, timeoutSeconds: 10, attempts: a.storage });
    const body = String(a.transport.mock.calls[0][1]?.body);
    expect(body).toContain(config.prompt); expect(body).toContain('importantEvents'); expect(body).not.toContain('mock-secret-v2');
    expect(a.current().memories.medium[0].sourceTurnIds).toHaveLength(18);
    expect(a.current().revision).toBe(100);
  });
  it('自动最多3次/分钟，手动一次可明确授权；不重复已覆盖来源', async () => {
    const a = setupRuntime(), input = { saveId: 'save-a', ...a, kind: 'short' as const, summaryConfig: defaultSummaryConfig('short'), timeoutSeconds: 10, attempts: a.storage, automatic: true };
    for (let i = 0; i < 3; i++) await a.runner.run(input);
    await expect(a.runner.run(input)).rejects.toMatchObject({ code: 'MEMORY_THROTTLED' });
    expect(a.transport).toHaveBeenCalledTimes(3);
    await a.runner.run({ ...input, automatic: false, immediate: true });
    expect(a.transport).toHaveBeenCalledTimes(4);
    const sources = a.current().memories.medium.flatMap(entry => entry.sourceTurnIds);
    expect(new Set(sources).size).toBe(40);
  });
  it.each([401, 429, 503])('HTTP%s失败后刷新仍不自动重发，原始状态不变，手动重试恰一次', async status => {
    let failed = true; const state = compressionState('short', 40);
    const a = setupRuntime(state, () => failed ? new Response('', { status }) : Response.json({ choices: [{ message: { content: JSON.stringify(publicOutput) } }] }));
    const input = { saveId: 'save-a', ...a, kind: 'short' as const, summaryConfig: defaultSummaryConfig('short'), timeoutSeconds: 10, attempts: a.storage, automatic: true };
    await expect(a.runner.run(input)).rejects.toBeDefined();
    await expect(a.runner.run(input)).rejects.toMatchObject({ code: 'MEMORY_PREVIOUS' });
    expect(a.transport).toHaveBeenCalledTimes(1); expect(a.current()).toEqual(state);
    failed = false; await a.runner.run({ ...input, automatic: false, immediate: true }); expect(a.transport).toHaveBeenCalledTimes(2);
  });
});
it('三类队列独立失败、串行公平调度、刷新阻止失败类；明确NPC目标', async () => {
  const state = compressionState('short', 90);
  state.memories.medium = state.memories.short.slice(31, 82).map(entry => ({ ...entry, id: `medium-${entry.id}` })); state.memories.short = state.memories.short.slice(0, 31);
  state.npc['npc-a'] = npcMemoryState(20).npc['npc-a'];
  const settings = defaultSettings(), storage = store(), calls: string[] = [];
  let active = 0, maximum = 0;
  const options = { saveId: 'save-a', storage, settings: () => settings, load: async () => state,
    execute: async (kind: string) => { active++; maximum = Math.max(maximum, active); calls.push(kind); await Promise.resolve(); active--; if (kind === 'short') throw new Error('private provider response should not escape'); }, changed: vi.fn() };
  const queue = new MemorySummaryQueue(options);
  await Promise.all([queue.wake(), queue.wake()]); expect(calls).toEqual(['short', 'medium', 'npc']); expect(maximum).toBe(1);
  const again = new MemorySummaryQueue(options); await again.wake(); expect(calls.filter(kind => kind === 'short')).toHaveLength(1);
  settings.memory.summaries.npc.automatic = false;
  await again.wake(); expect(calls.filter(kind => kind === 'medium')).toHaveLength(3);
  await queue.immediate('npc'); expect(options.changed).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ kind: 'npc', code: 'NPC_MEMORY_CONFLICT' })]));
});

it('三类自动全部关闭时后台静默跳过，但仍可各自立即总结一次', async () => {
  const state = compressionState('short', 90);
  state.memories.medium = state.memories.short.slice(31, 82).map(entry => ({ ...entry, id: `medium-${entry.id}` }));
  state.memories.short = state.memories.short.slice(0, 31);
  state.npc['npc-a'] = npcMemoryState(20).npc['npc-a'];
  const settings = defaultSettings(), storage = store();
  for (const config of Object.values(settings.memory.summaries)) config.automatic = false;
  const execute = vi.fn(async (_kind: string, _immediate: boolean, _npcId?: string) => {});
  const queue = new MemorySummaryQueue({ saveId: 'save-a', storage, settings: () => settings,
    load: async () => state, execute, changed: vi.fn() });
  await queue.wake();
  expect(execute).not.toHaveBeenCalled();
  await queue.immediate('short');
  await queue.immediate('medium');
  await queue.immediate('npc', 'npc-a');
  expect(execute.mock.calls.map(args => args[0])).toEqual(['short', 'medium', 'npc']);
  expect(execute.mock.calls.every(args => args[1] === true)).toBe(true);
});

it('请求开始前冻结配置；任务期间修改设置不改变已经选择的批次和提示词', async () => {
  const a = setupRuntime(), config = { ...defaultSummaryConfig('short'), prompt: '已冻结的内容提示词' };
  const pending = a.runner.run({ saveId: 'save-a', ...a, kind: 'short', summaryConfig: config, timeoutSeconds: 10 });
  config.batchSize = 18; config.prompt = '进行中的任务不可使用新提示词';
  await pending; expect(a.current().memories.medium[0].sourceTurnIds).toHaveLength(10);
  expect(String(a.transport.mock.calls[0][1]?.body)).toContain('已冻结的内容提示词');
  expect(String(a.transport.mock.calls[0][1]?.body)).not.toContain('进行中的任务不可使用新提示词');
});
it('NPC25/18通过真实请求和保存链路，固定协议使用当前阈值', async () => {
  const state = compressionState('short', 40); state.npc['npc-a'] = npcMemoryState(25).npc['npc-a'];
  const a = setupRuntime(state, () => Response.json({ choices: [{ message: { content: JSON.stringify({ summaries: [{ groupId: 'observed:npc_private', text: '他逐渐理解这些经历对自己的影响，并保留未完成的约定。' }], unresolved: [], contradictions: [] }) } }] }));
  const config = { ...defaultSummaryConfig('npc'), threshold: 25, batchSize: 18, prompt: '自定义 NPC 心理叙述提示词' };
  await a.runner.run({ saveId: 'save-a', ...a, kind: 'npc', npcId: 'npc-a', summaryConfig: config, timeoutSeconds: 10 });
  const body = String(a.transport.mock.calls[0][1]?.body); expect(body).toContain('自定义 NPC 心理叙述提示词'); expect(body).toContain('阈值 25');
  expect(a.current().memories.npcSummaries['npc-a'][0].npcProvenance!.sourceMemoryIds).toHaveLength(18);
  expect(a.current().npc).toEqual(state.npc);
});
it.each(['', ' ', '{', '{"summary":"截断', JSON.stringify({ summary: '概括存在但无事件清单' })])('不完整真实响应失败不写入、不自动重发：%s', async text => {
  const state = compressionState('short', 40), a = setupRuntime(state, () => Response.json({ choices: [{ message: { content: text } }] }));
  const input = { ...a, saveId: 'save-a', kind: 'short' as const, summaryConfig: defaultSummaryConfig('short'), attempts: a.storage, timeoutSeconds: 10, automatic: true };
  await expect(a.runner.run(input)).rejects.toBeDefined(); expect(a.current()).toEqual(state);
  await expect(a.runner.run(input)).rejects.toMatchObject({ code: 'MEMORY_PREVIOUS' }); expect(a.transport).toHaveBeenCalledTimes(1);
});

it('已完成IDB保存但确认标记清除前中断：刷新识别已有结果，不为旧来源再次付费', async () => {
  const a = setupRuntime();
  const created = a.current().createdAt;
  const key = `heijin.summary.attempt:save-a:${created}:short`;
  let savedId = '';
  const ledger = { getItem: a.storage.getItem, setItem: (name: string, value: string) => {
    if (name === key && !value && savedId) throw new Error('模拟确认标记写入失败');
    if (name === key && value) savedId = value;
    a.storage.setItem(name, value);
  } };
  const input = { ...a, saveId: 'save-a', kind: 'short' as const, summaryConfig: defaultSummaryConfig('short'), timeoutSeconds: 10, attempts: ledger, automatic: true };
  await expect(a.runner.run(input)).rejects.toThrow();
  expect(a.current().memories.medium[0].id).toBe(savedId);
  expect(a.transport).toHaveBeenCalledTimes(1);
  const { recoverCompletedSummary } = await import('../workflows/memoryMaintenance');
  expect(recoverCompletedSummary(a.current(), 'short', a.storage)).toBe(true);
  expect(a.storage.getItem(key)).toBe('');
  await a.runner.run({ ...input, attempts: a.storage });
  expect(a.transport).toHaveBeenCalledTimes(2);
  const ids = a.current().memories.medium.flatMap(entry => entry.sourceTurnIds);
  expect(new Set(ids).size).toBe(20);
});
it('每小时12次上限独立于分钟窗口，失败来源与正式状态不因节流改变', async () => {
  const a = setupRuntime(), state = a.current();
  a.storage.setItem(`heijin.summary.rate:save-a:${state.createdAt}`, JSON.stringify(Array.from({ length: 12 }, (_, i) => Date.now() - 120000 - i * 1000)));
  await expect(a.runner.run({ ...a, saveId: 'save-a', kind: 'short', summaryConfig: defaultSummaryConfig('short'), timeoutSeconds: 10, automatic: true, attempts: a.storage })).rejects.toMatchObject({ code: 'MEMORY_THROTTLED' });
  expect(a.transport).not.toHaveBeenCalled(); expect(a.current()).toEqual(state);
});
it.each(['network', 'storage'] as const)('%s失败保留所有来源并阻止刷新后自动付费重试', async kind => {
  const a = setupRuntime(), before = structuredClone(a.current());
  if (kind === 'network') a.transport.mockRejectedValue(new TypeError('mock network failure'));
  else a.repository.saveMemoryCompression = async () => { throw new DOMException('mock quota', 'QuotaExceededError'); };
  const input = { ...a, saveId: 'save-a', kind: 'short' as const, summaryConfig: defaultSummaryConfig('short'), timeoutSeconds: 10, automatic: true, attempts: a.storage };
  await expect(a.runner.run(input)).rejects.toBeDefined(); expect(a.current()).toEqual(before);
  await expect(a.runner.run(input)).rejects.toMatchObject({ code: 'MEMORY_PREVIOUS' }); expect(a.transport).toHaveBeenCalledTimes(1);
});
it('切档或暂停发生在异步读档期间，旧队列不得启动新请求', async () => {
  for (const stop of [true, false]) {
    const settings = defaultSettings(), execute = vi.fn(); let release!: (state: ReturnType<typeof compressionState>) => void;
    const queue = new MemorySummaryQueue({ saveId: 'save-a', storage: store(), settings: () => settings,
      load: () => new Promise(resolve => { release = resolve; }), execute, changed: vi.fn() });
    const pending = queue.wake(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (stop) queue.stop(); else for (const value of Object.values(settings.memory.summaries)) value.automatic = false;
    release(compressionState()); await pending; expect(execute).not.toHaveBeenCalled();
  }
});
it('切换立即总结目标不能清除另一NPC的未处理失败或重新授权自动收费', async () => {
  const state = npcMemoryState(20), settings = defaultSettings(), calls: string[] = [], storage = store();
  settings.memory.summaries.short.automatic = false; settings.memory.summaries.medium.automatic = false;
  state.npc['npc-b'].memories = state.npc['npc-a'].memories.map(entry => ({ ...entry, id: `b-${entry.id}`, affectedEntityRefs: [{ kind: 'npc' as const, id: 'npc-b' }] }));
  const options = { saveId: 'save-a', storage, settings: () => settings, load: async () => state,
    execute: async (_kind: string, _immediate: boolean, npcId?: string) => { calls.push(npcId!); if (npcId === 'npc-a') throw new Error('mock failure'); }, changed: vi.fn() };
  const queue = new MemorySummaryQueue(options); await queue.wake(); await queue.immediate('npc', 'npc-b');
  await queue.wake(); await new MemorySummaryQueue(options).wake();
  expect(calls).toEqual(['npc-a']);
  expect(options.changed).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ kind: 'npc', npcId: 'npc-a' })]));
});
it('NPC25/18未编辑默认提示词：真实完整请求包含精确18条来源且没有固定十五条要求', async () => {
  const state = npcMemoryState(25);
  const a = setupRuntime(state, () => Response.json({ choices: [{ message: { content: JSON.stringify({ summaries: [{ groupId: 'observed:npc_private', text: '他回顾这些经历及其对心态的影响。' }], unresolved: [], contradictions: [] }) } }] }));
  const config = { ...defaultSummaryConfig('npc'), threshold: 25, batchSize: 18 };
  await a.runner.run({ ...a, saveId: 'save-a', kind: 'npc', npcId: 'npc-a', summaryConfig: config, timeoutSeconds: 10 });
  const body = JSON.parse(String(a.transport.mock.calls[0][1]?.body)) as { messages: { content: string }[] };
  const full = body.messages.map(message => message.content).join('\n');
  expect(full).not.toMatch(/十五条|15\s*条/);
  expect(full).toContain(config.prompt); expect(full).toContain('第三人称'); expect(full).toContain('心理');
  const context = JSON.parse(full.match(/<GAME_CONTEXT>\n([\s\S]*?)\n<\/GAME_CONTEXT>/)![1]);
  const entries = context.MEMORY_TASK.groups.flatMap((group: { entries: { id: string }[] }) => group.entries);
  expect(entries.map((entry: { id: string }) => entry.id)).toEqual(state.npc['npc-a'].memories.slice(0, 18).map(entry => entry.id));
  expect(a.current().memories.npcSummaries['npc-a'][0].npcProvenance!.sourceMemoryIds).toHaveLength(18);
});
it('旧默认false迁移及序列化后不自动收费，手动逐项开启不会影响另外两类', () => {
  const old = { ...defaultSettings(), memory: { immediateWindowSize: 7, automaticMaintenance: false } };
  const migrated = SettingsSchema.parse(old);
  expect(migrated.memory.automaticMaintenance).toBe(false);
  expect(Object.values(migrated.memory.summaries).every(config => !config.automatic)).toBe(true);
  migrated.memory.summaries.npc.automatic = true;
  const refreshed = SettingsSchema.parse(JSON.parse(JSON.stringify(migrated)));
  expect(refreshed.memory.automaticMaintenance).toBe(false);
  expect(refreshed.memory.immediateWindowSize).toBe(7);
  expect(refreshed.memory.summaries.npc.automatic).toBe(true);
  expect(refreshed.memory.summaries.short.automatic).toBe(false);
  expect(refreshed.memory.summaries.medium.automatic).toBe(false);
  expect(Object.values(defaultSettings().memory.summaries).every(config => config.automatic)).toBe(true);
});
