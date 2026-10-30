import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { promptManifest } from '../prompts/manifest';
import { readPromptResource } from '../prompts/loader';
import { composePrompt } from '../prompts/composer';
import { moduleActivation, selectPromptModules, comparePromptModes } from '../prompts/selection';
import {
  PromptOrderSchema,
  readPromptOrder,
  savePromptOrder,
  movePromptOrder,
  projectPromptOrder,
  promptOrderKey,
} from '../prompts/order';
import { buildStagePreviews } from '../prompts/preview';
import { characterCount, contextStatistics } from '../prompts/statistics';
import {
  RequestInspectionStore,
  requestInspections,
  redactInspection,
  inspectedContext,
} from '../services/ai/inspection';
import { AiClient } from '../services/ai/client';
import { requestSnapshot } from '../services/ai/snapshot';
import { defaultAiConfig, newChannel, saveAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { runStageRequest } from '../services/ai/runtime';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game } from './fixtures/game';
import { uiFixture } from './fixtures/ui';
import { playerView } from '../ui/panels/playerView';

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: (key: string) => {
      data.delete(key);
    },
    data,
  };
}
function input(mode: 'opening' | 'regular' = 'regular') {
  const state = game();
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 1;
  const draft = rerollStory(
    createTurnDraft(state.saveId, state.revision, 'inspect-turn', mode, '观察'),
    { turnKind: mode, narrative: '【旁白】街道安静。', summary: '', variableGuide: [] },
  );
  return {
    stage: 'story' as const,
    state,
    settings,
    draft,
    mode,
    userInput: '观察',
    domains: ['economy'],
  };
}
function setup(protocol: Protocol = 'openai') {
  const channel = { ...newChannel(protocol), name: '测试渠道', defaultModel: 'mock-model' };
  const config = defaultAiConfig();
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '' };
  const vault = new CredentialVault(storage(), storage());
  vault.set(channel.id, 'inspector-test-credential');
  return { config, channel, vault };
}
function response(protocol: Protocol, text = 'OK') {
  return Response.json(
    protocol === 'gemini'
      ? {
          candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 2, totalTokenCount: 13 },
        }
      : protocol === 'anthropic'
        ? {
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 11, output_tokens: 2 },
          }
        : {
            choices: [{ message: { content: text }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 },
          },
  );
}
beforeEach(() => requestInspections.clear());
afterEach(() => vi.unstubAllGlobals());

describe('真实资源库、选择器与独立排序', () => {
  it('全部注册原文直接读取真实文件，未为显示维护提示词副本', async () => {
    for (const module of promptManifest.modules)
      expect(await readPromptResource(module.id)).toBe(
        await readFile(new URL(`../../prompts/${module.path}`, import.meta.url), 'utf8'),
      );
  });
  it('激活状态按真实选择器区分启用、未启用、不适用，常驻无开关', () => {
    const a = input();
    a.settings.prompts.noControl = false;
    const state = (id: string) =>
      moduleActivation(
        promptManifest.modules.find((m) => m.id === id)!,
        a,
      ).status;
    expect(state('identity.fusheng')).toBe('enabled');
    expect(state('writing.no_control')).toBe('disabled');
    expect(state('stages.opening.story')).toBe('not-applicable');
    expect(state('docs.ASSEMBLY')).toBe('not-applicable');
    const difference = comparePromptModes(a);
    expect(difference.openingOnly.map((m) => m.id)).toEqual(['stages.opening.story', 'planning.opening']);
    expect(difference.regularOnly.map((m) => m.id)).toEqual(['stages.regular.story', 'planning.regular']);
    expect(difference.shared.some((m) => m.id === 'writing.nsfw')).toBe(true);
    expect(state('variableGroups.economy.update')).toBe('not-applicable');
    expect(promptManifest.modules.find((m) => m.id === 'writing.nsfw')).toMatchObject({
      activation: 'always',
      toggle: null,
      configurable: false,
    });
    expect(Object.keys(SettingsSchema.shape.prompts.shape)).toEqual([
      'perspective',
      'style',
      'minNarrativeChars',
      'noControl',
      'naturalProse',
      'actionOptions',
      'realWorld',
    ]);
  });
  it.each(['opening', 'regular'] as const)(
    '%s 三阶段选择与预览仍互斥且不调用 fetch',
    async (mode) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const result = await buildStagePreviews(input(mode), defaultAiConfig());
      for (const stage of ['story', 'variables', 'world'] as const) {
        const preview = result[stage];
        expect(preview.ok).toBe(true);
        if (!preview.ok) throw new Error();
        const ids = preview.prompt.modules.map((m) => m.id);
        expect(ids.filter((id) => id.startsWith('stages.'))).toEqual([`stages.${mode}.${stage}${stage === 'variables' ? '.text' : ''}`]);
        expect(ids.filter((id) => id === 'writing.nsfw')).toHaveLength(stage === 'story' ? 1 : 0);
        expect(preview.statistics.actual.inputTokens).toBeUndefined();
        expect(preview.prompt.modules.every((m) => m.estimatedTokens > 0)).toBe(true);
        if (stage !== 'story') expect(ids).not.toContain('shared.06_story_output');
        expect(ids.filter((id) => id.startsWith('variableGroups.'))).toHaveLength(
          stage === 'story' ? 0 : 1,
        );
      }
      expect(fetcher).not.toHaveBeenCalled();
      expect(requestInspections.getSnapshot()).toEqual([]);
    },
  );
  it('合法同组排序独立保存、读取、重新组装和恢复默认', async () => {
    const store = storage();
    const a = input();
    const before = structuredClone(a.state);
    const defaults = (await composePrompt(a)).modules.map((m) => m.id);
    const orders = movePromptOrder({}, 'writing.conflict_pacing', 'writing.action_feasibility');
    savePromptOrder(store, orders);
    expect([...store.data.keys()]).toEqual([promptOrderKey]);
    expect(readPromptOrder(store).overrides).toEqual(orders);
    const changed = await composePrompt({
      ...a,
      orderPreferences: readPromptOrder(store).overrides,
    });
    expect(changed.modules.filter((m) => m.order >= 80 && m.order <= 82).map((m) => m.id)).toEqual([
      'writing.action_feasibility',
      'writing.emotion_guard',
      'writing.conflict_pacing',
    ]);
    savePromptOrder(store, {});
    expect(
      (
        await composePrompt({ ...a, orderPreferences: readPromptOrder(store).overrides })
      ).modules.map((m) => m.id),
    ).toEqual(defaults);
    expect(a.state).toEqual(before);
  });
  it.each<Record<string, number>>([
    { 'identity.fusheng': 1 },
    { 'writing.conflict_pacing': 224, 'writing.no_control': 80 },
    { 'writing.conflict_pacing': 81 },
    { unknown: 80 },
    { 'writing.nsfw': 224 },
  ])('非法全局排序 %j 无法保存或组装', async (overrides) => {
    const store = storage();
    expect(PromptOrderSchema.safeParse({ version: 1, overrides }).success).toBe(false);
    expect(() => savePromptOrder(store, overrides)).toThrow();
    await expect(composePrompt({ ...input(), orderPreferences: overrides })).rejects.toThrow();
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('关闭写作模块不会破坏排序偏好，剩余模块只占其合法槽位，重新开启恢复相对顺序', async () => {
    const a = input();
    const orders = movePromptOrder({}, 'writing.no_control', 'writing.real_world');
    a.settings.prompts.noControl = false;
    const projected = projectPromptOrder(orders, selectPromptModules(a));
    expect(projected['writing.no_control']).toBeUndefined();
    const off = await composePrompt({ ...a, orderPreferences: orders });
    expect(off.modules.filter((m) => m.order >= 224 && m.order <= 227).map((m) => m.id)).toEqual([
      'writing.real_world',
      'writing.natural_prose',
      'writing.action_options',
    ]);
    expect(orders['writing.no_control']).toBe(227);
    a.settings.prompts.noControl = true;
    const on = await composePrompt({ ...a, orderPreferences: orders });
    expect(on.modules.filter((m) => m.order >= 224 && m.order <= 227).map((m) => m.id)).toEqual([
      'writing.real_world',
      'writing.natural_prose',
      'writing.action_options',
      'writing.no_control',
    ]);
    await expect(
      composePrompt({ ...a, orderOverrides: { 'identity.fusheng': 10 } }),
    ).rejects.toThrow();
  });
  it('没有已选正文/模式不匹配时如实阻止变量和世界预览，不造草稿', async () => {
    const a = input('opening');
    const before = structuredClone(a.state);
    const result = await buildStagePreviews({ ...a, draft: undefined }, defaultAiConfig());
    expect(result.story.ok).toBe(true);
    expect(result.variables).toMatchObject({ ok: false, reason: expect.stringContaining('缺少') });
    expect(result.world.ok).toBe(false);
    const mismatch = await buildStagePreviews({ ...a, mode: 'regular' }, defaultAiConfig());
    expect(mismatch.story.ok).toBe(true);
    expect(mismatch.variables).toMatchObject({
      ok: false,
      reason: expect.stringContaining('模式'),
    });
    expect(a.state).toEqual(before);
  });
});
describe('内存请求快照、安全边界和 Token 统计', () => {
  it('字符数按 Unicode，启发式估算与供应商用量分开，缺失总量不求和', () => {
    expect(characterCount('a中🙂')).toBe(3);
    const stats = contextStatistics([{ role: 'user', content: 'a中🙂' }], {
      inputTokens: 11,
      outputTokens: 0,
    });
    expect(stats.characters).toBe(3);
    expect(stats.method).toBe('unicode-heuristic-v1');
    expect(stats.actual).toEqual({ inputTokens: 11, outputTokens: 0, totalTokens: undefined });
    expect(stats.estimatedTokens).not.toBe(stats.actual.inputTokens);
    expect(contextStatistics([]).actual).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });
  it('脱敏覆盖密钥原文、嵌套鉴权字段和 Bearer 字符串，不修改源数据', () => {
    const original = {
      headers: { Authorization: 'Bearer different-secret', 'x-api-key': 'another-secret' },
      content: 'inspector-test-credential',
      nested: [{ apiKey: 'private' }],
    };
    const safe = redactInspection(original, ['inspector-test-credential']);
    for (const text of [
      'inspector-test-credential',
      'different-secret',
      'another-secret',
      'private',
    ])
      expect(JSON.stringify(safe)).not.toContain(text);
    expect(original.content).toBe('inspector-test-credential');
  });
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 快照来自传输使用的同一原生请求体，去头去密钥，不记录响应正文/推理',
    async (protocol) => {
      const a = setup(protocol);
      const snapshot = requestSnapshot(a.config, 'story', a.vault);
      const messages = [
        { role: 'system' as const, content: '规则' },
        { role: 'user' as const, content: '行动' },
      ];
      const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        const [captured] = requestInspections.getSnapshot();
        expect(captured.status).toBe('pending');
        expect(captured.body).toEqual(JSON.parse(String(init?.body)));
        return response(protocol, '只在响应中存在，不进入查看器');
      });
      await new AiClient(transport).generate(snapshot, messages);
      const [captured] = requestInspections.getSnapshot();
      expect(captured.scope).toBeUndefined();
      expect(captured.status).toBe('received');
      expect(captured.messages).toEqual(messages);
      expect(captured.statistics.actual.inputTokens).toBe(11);
      expect(captured.statistics.actual.totalTokens).toBe(
        protocol === 'anthropic' ? undefined : 13,
      );
      expect(JSON.stringify(captured)).not.toContain('inspector-test-credential');
      expect(JSON.stringify(captured)).not.toContain('Authorization');
      expect(JSON.stringify(captured)).not.toContain('只在响应中存在');
      expect(Object.isFrozen(captured.body)).toBe(true);
    },
  );
  it('阶段请求应用已保存排序并捕获真实快照，后台仅存在内部记录，玩家视图和正式状态不变', async () => {
    const a = setup();
    const source = input();
    source.state = uiFixture();
    source.draft = rerollStory(
      createTurnDraft(
        source.state.saveId,
        source.state.revision,
        'world-inspection',
        'regular',
        '行动',
      ),
      source.draft.story!,
    );
    const store = storage();
    savePromptOrder(
      store,
      movePromptOrder({}, 'writing.conflict_pacing', 'writing.action_feasibility'),
    );
    vi.stubGlobal('window', { localStorage: store });
    const before = structuredClone(source.state);
    await expect(
      runStageRequest({ ...source, orderOverrides: {}, orderPreferences: {} }, a.config, a.vault),
    ).rejects.toMatchObject({ code: 'configuration' });
    const text = '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>【旁白】观察街道。</正文><短期记忆>观察</短期记忆><变量规划>[]</变量规划>';
    source.settings.prompts.actionOptions = false;
    const client = new AiClient(vi.fn<typeof fetch>().mockResolvedValue(response('openai', text)));
    await runStageRequest(source, a.config, a.vault, { stream: false }, client);
    const storyRecord = requestInspections.getSnapshot()[0];
    expect(
      storyRecord.scope?.modules.filter((m) => m.order >= 80 && m.order <= 82).map((m) => m.id),
    ).toEqual(['writing.action_feasibility', 'writing.emotion_guard', 'writing.conflict_pacing']);
    const worldClient = new AiClient(
      vi.fn<typeof fetch>().mockResolvedValue(
        response(
          'openai',
          JSON.stringify({
            worldCommands: [],
            taskCommands: [],
            eventCommands: [],
            futureEvents: [],
            visibleHooks: [],
            timelineCandidates: [],
            unresolved: [],
          }),
        ),
      ),
    );
    await runStageRequest({ ...source, stage: 'world' }, a.config, a.vault, {}, worldClient);
    const [captured] = requestInspections.getSnapshot();
    expect(captured.scope).toMatchObject({
      kind: 'stage',
      mode: 'regular',
      saveId: source.state.saveId,
      revision: source.state.revision,
    });
    expect(inspectedContext(captured.messages)?.OFFSCREEN_STATE).toBeDefined();
    expect(JSON.stringify(captured)).toContain('秘密计划不可见');
    expect(JSON.stringify(playerView(source.state))).toContain('不可见');
    expect(source.state).toEqual(before);
    expect(store.setItem).toHaveBeenCalledTimes(1);
  });
  it('发送时一并脱敏其他已配置渠道的密钥，删除渠道后历史快照也不恢复凭证', () => {
    const a = setup();
    const local = storage(),
      session = storage();
    const other = { ...newChannel(), defaultModel: 'other' };
    a.config.channels.push(other);
    saveAiConfig(local, a.config);
    const vault = new CredentialVault(session, local);
    vault.set(other.id, 'other-channel-test-credential');
    vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
    const store = new RequestInspectionStore();
    store.start(
      requestSnapshot(a.config, 'story', a.vault),
      JSON.stringify({ messages: [{ role: 'user', content: 'other-channel-test-credential' }] }),
    );
    vault.delete(other.id);
    expect(JSON.stringify(store.getSnapshot())).not.toContain('other-channel-test-credential');
  });
  it('已取消的请求不制造发送记录，超时后的迟到响应不能覆盖失败状态', async () => {
    const a = setup();
    const snap = requestSnapshot(a.config, 'story', a.vault);
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new AiClient(fetcher).generate(snap, [{ role: 'user', content: '动作' }], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(requestInspections.getSnapshot()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    let finish!: (value: Response) => void;
    const pending = new AiClient(
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    ).generate(snap, [{ role: 'user', content: '动作' }], { timeoutSeconds: 0.01 });
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    finish(response('openai'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestInspections.getSnapshot()[0]).toMatchObject({
      status: 'failed',
      errorCode: 'timeout',
    });
  });
  it('记录有容量限制且只留内存，清空后迟到结束不重新插入', () => {
    const a = setup();
    const snap = requestSnapshot(a.config, 'story', a.vault);
    const store = new RequestInspectionStore();
    let id = '';
    for (let i = 0; i < 15; i++)
      id = store.start(snap, JSON.stringify({ messages: [{ role: 'user', content: String(i) }] }));
    expect(store.getSnapshot()).toHaveLength(12);
    store.clear();
    store.finish(id, { inputTokens: 1 });
    expect(store.getSnapshot()).toEqual([]);
  });
});
