import { afterEach, expect, test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import type { StoryProgress } from '../workflows/storyStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings, SettingsSchema, settingsKey } from '../ui/settings/model';
import { readDocument } from '../services/local/documents';
import { createTurnDraft } from '../domain/drafts';
import { game } from './fixtures/game';

const narrative = '主角在站台看着来往车辆，保持安静等候。';
const text = `<thinking>保持场景连续。</thinking><正文>${narrative}</正文><短期记忆>站台等候。</短期记忆><变量规划>[]</变量规划>`;
const repos: SaveRepository[] = [], stages: StoryStage[] = [];
afterEach(() => { stages.splice(0).forEach(s => s.dispose()); repos.splice(0).forEach(r => r.close()); vi.restoreAllMocks(); });
async function fixture(protocol: Protocol = 'openai', stream = false) {
  const repo = await SaveRepository.open('story-stream-toggle', new IDBFactory()); repos.push(repo);
  await repo.create(game());
  const draft = await repo.saveDraft(createTurnDraft('save-a', 0, 'story-toggle', 'opening', ''), null);
  const channel = newChannel(protocol), config = defaultAiConfig();
  config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: 'story' };
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'synthetic-story-key');
  const settings = { ...defaultSettings(), runtime: { ...defaultSettings().runtime, streamStory: stream } };
  settings.prompts.actionOptions = false; settings.prompts.minNarrativeChars = 5;
  return { repo, draft, settings, config, vault, storage };
}
function json(protocol: Protocol, value = text, reason = 'stop') {
  return protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: value }] }, finishReason: reason === 'stop' ? 'STOP' : reason === 'length' ? 'MAX_TOKENS' : reason === 'content_filter' ? 'SAFETY' : reason }] }
    : protocol === 'anthropic' ? { content: [{ type: 'text', text: value }], stop_reason: reason === 'stop' ? 'end_turn' : reason === 'length' ? 'max_tokens' : reason }
    : { choices: [{ message: { content: value, reasoning_content: '供应商完整思考' }, finish_reason: reason }] };
}
function runner(a: Awaited<ReturnType<typeof fixture>>, transport: typeof fetch) {
  const stage = new StoryStage(a.repo, new AiClient(transport)); stages.push(stage); return stage;
}
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }

test('旧设置缺字段时正文默认流式开启，不写回或重置其他设置', async () => {
  const a = await fixture(), old = JSON.parse(JSON.stringify(defaultSettings()));
  delete old.runtime.streamStory; old.runtime.streamVariables = true; old.runtime.timeoutSeconds = 73;
  a.storage.setItem(settingsKey, JSON.stringify(old)); const write = vi.spyOn(a.storage, 'setItem');
  const restored = readDocument(a.storage, settingsKey, SettingsSchema)!;
  expect(Reflect.get(defaultSettings().runtime, 'streamStory')).toBe(true);
  expect(restored.runtime).toEqual({ ...old.runtime, streamStory: true });
  expect(restored.version).toBe(1); expect(write).not.toHaveBeenCalled();
  expect(SettingsSchema.safeParse({ ...old, runtime: { ...old.runtime, streamStory: 'false' } }).success).toBe(false);
});

test('非流式传输为false，响应校验及CAS保存完成之前不展示正文', async () => {
  const a = await fixture(), responseGate = gate(), saveGate = gate(), progress: StoryProgress[] = [];
  const before = await a.repo.loadGame('save-a'), save = a.repo.saveDraft.bind(a.repo);
  let saving = false;
  vi.spyOn(a.repo, 'saveDraft').mockImplementation(async (...args) => { saving = true; await saveGate.promise; return save(...args); });
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).stream).toBe(false); await responseGate.promise;
    return new Response(JSON.stringify(json('openai')), { headers: { 'content-type': 'application/json' } });
  });
  const pending = runner(a, transport).generate({ ...a, onProgress: p => progress.push(p) });
  void pending.catch(() => undefined);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  expect(progress.at(-1)).toMatchObject({ readingPhase: 'waiting', narrative: '' });
  a.settings.runtime.streamStory = true; // The in-flight snapshot must stay non-streaming.
  responseGate.release(); await vi.waitFor(() => expect(saving).toBe(true));
  expect(progress.every(p => p.readingPhase === 'waiting' && p.narrative === '' && !p.nativeReasoning)).toBe(true);
  expect(await a.repo.loadGame('save-a')).toEqual(before);
  saveGate.release(); const saved = await pending;
  expect(saved.story?.narrative).toBe(narrative); expect(await a.repo.loadDraft('save-a')).toEqual(saved);
  expect(await a.repo.load('save-a')).toEqual(before.state); expect(transport).toHaveBeenCalledTimes(1);
});

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  test(`${protocol} 非流式JSON仍使用真实Composer/解析/草稿CAS，只发一次请求`, async () => {
    const a = await fixture(protocol), before = await a.repo.load('save-a');
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (protocol === 'gemini') { expect(String(url)).toContain(':generateContent'); expect(String(url)).not.toContain(':streamGenerateContent'); }
      else expect(body.stream).toBe(false);
      expect(JSON.stringify(body)).not.toContain('streamStory');
      return Response.json(json(protocol));
    });
    const saved = await runner(a, transport).generate(a);
    expect(saved.story?.narrative).toBe(narrative); expect(saved.storyRevision).toBe(1);
    expect(await a.repo.load('save-a')).toEqual(before); expect(transport).toHaveBeenCalledTimes(1);
  });
  for (const [finish, code] of [['length', 'output_limit'], ['content_filter', 'content_filter'], ['unrecognized', 'stream_interrupted']] as const) {
    test(`${protocol} 非流式${finish}按完整内容校验，不重试、不改正式状态`, async () => {
      const a = await fixture(protocol), before = await a.repo.loadGame('save-a');
      const transport = vi.fn<typeof fetch>(async () => Response.json(json(protocol, text, finish)));
      if (finish === 'length') {
        const saved = await runner(a, transport).generate(a);
        expect(saved.stageStatus.story).toBe('ready');
        expect(saved.story?.narrative).toBe(narrative);
        expect(saved.storyPartial).toBeUndefined();
        expect((await a.repo.loadGame('save-a')).state).toEqual(before.state);
      } else {
        await expect(runner(a, transport).generate(a)).rejects.toMatchObject({ code });
        expect(await a.repo.loadGame('save-a')).toEqual(before);
      } expect(transport).toHaveBeenCalledTimes(1);
    });
  }
}

test.each(['invalid-json', 'missing-body', 'too-short'] as const)('非流式%s沿用正式校验，手动失败只保存安全摘要', async mode => {
  const a = await fixture(), before = await a.repo.loadGame('save-a');
  const transport = vi.fn<typeof fetch>(async () => mode === 'invalid-json' ? new Response('{')
    : Response.json(json('openai', mode === 'missing-body' ? '<thinking>场景计划</thinking>' : text.replace(narrative, '短'))));
  const onFailureSaved = vi.fn();
  await expect(runner(a, transport).generate({ ...a, onFailureSaved })).rejects.toBeDefined();
  const failed = await a.repo.loadGame('save-a'); expect(failed.state).toEqual(before.state);
  expect(failed.draft?.story).toBeUndefined(); expect(failed.draft?.stageStatus.story).toBe('failed');
  expect(failed.draft?.failures).toHaveLength(1); expect(onFailureSaved).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1);
});

test('非流式等待可取消，迟到JSON不保存、不新增失败摘要或请求', async () => {
  const a = await fixture(), before = await a.repo.loadGame('save-a'), responseGate = gate();
  const transport = vi.fn<typeof fetch>(async () => { await responseGate.promise; return Response.json(json('openai')); });
  const stage = runner(a, transport), pending = stage.generate({ ...a, onFailureSaved: vi.fn() });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1)); expect(stage.cancel()).toBe(true);
  await rejected; responseGate.release(); await Promise.resolve();
  expect(await a.repo.loadGame('save-a')).toEqual(before); expect(transport).toHaveBeenCalledTimes(1);
});

test('非流式等待仍会超时，不静默改为流式或自动重发', async () => {
  const a = await fixture(), before = await a.repo.loadGame('save-a'); a.settings.runtime.timeoutSeconds = 1;
  const transport = vi.fn<typeof fetch>(async () => new Promise<Response>(() => undefined));
  await expect(runner(a, transport).generate(a)).rejects.toMatchObject({ code: 'timeout' });
  expect(await a.repo.loadGame('save-a')).toEqual(before); expect(transport).toHaveBeenCalledTimes(1);
});

test('非流式500仍只按既有Coordinator策略尝试两次，模式不会静默切换', async () => {
  const a = await fixture(); a.settings.runtime.useVariableStage = false; a.settings.runtime.useWorldStage = false;
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).stream).toBe(false); return new Response('', { status: 500 });
  });
  const coordinator = new TurnCoordinator(a.repo, new AiClient(transport));
  try {
    await expect(coordinator.generate(a)).rejects.toMatchObject({ code: 'server' });
    expect(transport).toHaveBeenCalledTimes(2);
    const failed = await a.repo.loadDraft('save-a'); expect(failed?.failures.map(f => f.errorCode)).toEqual(['server', 'server']);
  } finally { coordinator.dispose(); }
});

test('非流式仍在付费请求前要求Web Locks，不支持时零请求且草稿不变', async () => {
  const a = await fixture(), before = await a.repo.loadGame('save-a'), transport = vi.fn<typeof fetch>();
  vi.stubGlobal('window', {}); vi.stubGlobal('navigator', {});
  try {
    await expect(runner(a, transport).generate(a)).rejects.toMatchObject({ code: 'concurrency_unavailable' });
    expect(transport).not.toHaveBeenCalled(); expect(await a.repo.loadGame('save-a')).toEqual(before);
  } finally { vi.unstubAllGlobals(); }
});

test('非流式等待期间正式版本改变，迟到完整JSON仍被原有CAS拒绝', async () => {
  const a = await fixture(), responseGate = gate();
  const transport = vi.fn<typeof fetch>(async () => { await responseGate.promise; return Response.json(json('openai')); });
  const pending = runner(a, transport).generate(a); void pending.catch(() => undefined);
  await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  const updated = await a.repo.save('save-a', 0, 'other-tab', [{ type: 'SetWorldClock', commandId: 'independent-clock', evidence: '合成独立更新', worldClock: '2026-10-18T09:00:00+08:00' }]);
  responseGate.release(); await expect(pending).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(await a.repo.load('save-a')).toEqual(updated); expect(await a.repo.loadDraft('save-a')).toEqual(a.draft); expect(transport).toHaveBeenCalledTimes(1);
});
