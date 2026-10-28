import { completeDraft, submission } from './fixtures/turn';
import { variableReply } from './fixtures/variableReply';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { VariableStage } from '../workflows/variableStage';
import { StoryStage } from '../workflows/storyStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { createTurnDraft, rerollStory, TurnDraftSchema, startStageAttempt } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { requestInspections } from '../services/ai/inspection';
import { game, gameTime } from './fixtures/game';

const text = '主角已经用现金支付30元吃饭。';
const result = {
  commands: [
    {
      commandId: 'text-v1:s1:c1',
      type: 'SpendFunds',
      evidence: '文本变量指令第1条',
      account: 'cash',
      amount: 3000,
      purpose: '剧情消费',
    },
  ],
  rejectedSuggestions: [],
  unresolved: [],
};
function setup(protocol: Protocol = 'openai') {
  const channel = { ...newChannel(protocol), defaultModel: 'variables-only' };
  const storyChannel = { ...newChannel(), defaultModel: 'story-only' };
  const config = defaultAiConfig();
  config.channels = [storyChannel, channel];
  config.routes.story = { channelId: storyChannel.id, modelId: '' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: '' };
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const vault = new CredentialVault(store, store);
  config.channels.forEach((item) => vault.set(item.id, 'mock-variable-key'));
  return { config, vault, settings: defaultSettings() };
}
function wire(value: unknown = result, protocol: Protocol = 'openai') {
  const text = typeof value === 'string' ? value : variableReply(value);
  return Response.json(
    protocol === 'openai'
      ? {
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 23, completion_tokens: 9, total_tokens: 32 },
        }
      : protocol === 'gemini'
        ? {
            candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 23 },
          }
        : {
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 23 },
          },
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
let repo: SaveRepository, draft: TurnDraft;
const stages: { dispose: () => void }[] = [];
function runner(fetcher: typeof fetch) {
  const stage = new VariableStage(repo, new AiClient(fetcher));
  stages.push(stage);
  return stage;
}
beforeEach(async () => {
  repo = await SaveRepository.open('variable-stage-test', new IDBFactory());
  await repo.create(game());
  const initial = createTurnDraft('save-a', 0, 'turn-a', 'opening', '开局偏好');
  await repo.saveDraft(initial, null);
  draft = rerollStory(initial, {
    turnKind: 'opening',
    narrative: text,
    summary: '吃饭',
    variableGuide: [],
  });
  await repo.saveDraft(draft, 0);
  requestInspections.clear();
});
afterEach(() => {
  stages.splice(0).forEach((stage) => stage.dispose());
  repo.close();
  vi.restoreAllMocks();
});

describe('变量阶段真实请求到草稿保存', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 独立路由/真实目录/开局模块/候选/usage，正式状态不变',
    async (protocol) => {
      const before = await repo.load('save-a'),
        client = vi.fn<typeof fetch>(async () => wire(result, protocol));
      const saved = await runner(client).generate({ ...setup(protocol), draft });
      expect(saved.story).toEqual(draft.story);
      expect(saved.storyRevision).toBe(1);
      expect(saved.draftRevision).toBe(3);
      expect(saved.executionRevision).toBe(1);
      expect(saved.stageRequestRevisions.variables).toBe(1);
      expect(saved.variables).toMatchObject({
        storyRevision: 1,
        requestRevision: 1,
        candidateRevision: 1,
        validation: 'validated',
        result,
      });
      expect(saved.stageStatus.variables).toBe('ready');
      expect(await repo.loadDraft('save-a')).toEqual(saved);
      expect(await repo.load('save-a')).toEqual(before);
      const [inspection] = requestInspections.getSnapshot();
      expect(inspection.stage).toBe('variables');
      expect(inspection.route.model).toBe('variables-only');
      expect(inspection.scope?.modules.some((m) => m.id === 'stages.opening.variables.text')).toBe(true);
      expect(
        inspection.scope?.modules.filter((m) => m.id.startsWith('variableGroups.')),
      ).toHaveLength(9);
      expect(JSON.stringify(inspection.body)).toContain('turn-a');
      expect(JSON.stringify(inspection.body)).toContain('SpendFunds');
      expect(JSON.stringify(inspection)).not.toContain('mock-variable-key');
      expect(inspection.statistics.actual.inputTokens).toBe(23);
      expect(client).toHaveBeenCalledTimes(1);
    },
  );
  it('未保存正文、正文未 ready 和过期草稿均不发请求', async () => {
    const transport = vi.fn<typeof fetch>(async () => wire());
    const stage = runner(transport);
    for (const invalid of [
      {
        ...draft,
        story: undefined,
        stageStatus: { ...draft.stageStatus, story: 'pending' as const },
      },
      { ...draft, draftRevision: 100 },
      { ...draft, baseSaveRevision: 1 },
    ]) {
      await expect(stage.generate({ ...setup(), draft: invalid })).rejects.toBeDefined();
    }
    expect(transport).not.toHaveBeenCalled();
    expect(await repo.loadDraft('save-a')).toEqual(draft);
  });
  it('正文未完成的真实仓库草稿明确拒绝，运行开关关闭不发请求', async () => {
    await repo.deleteDraft('save-a', draft.draftRevision);
    const pending = createTurnDraft('save-a', 0, 'pending', 'opening', '');
    await repo.saveDraft(pending, null);
    const transport = vi.fn<typeof fetch>(async () => wire());
    await expect(runner(transport).generate({ ...setup(), draft: pending })).rejects.toBeDefined();
    expect(await repo.loadDraft('save-a')).toEqual(pending);
    expect(transport).not.toHaveBeenCalled();
  });
  it('显式重新生成新尝试保留正文，递增候选并使旧世界候选失效', async () => {
    let first = await runner(async () => wire()).generate({ ...setup(), draft });
    first = await repo.saveDraft(startStageAttempt(first, ['world']), first.draftRevision);
    first = TurnDraftSchema.parse({
      ...first,
      draftRevision: first.draftRevision + 1,
      world: {
        storyRevision: 1,
        candidateRevision: 1,
        requestRevision: first.stageRequestRevisions.world,
        basedOnVariableRevision: first.variables?.candidateRevision,
        validation: 'validated',
        result: {
          worldCommands: [],
          taskCommands: [],
          eventCommands: [],
          futureEvents: [],
          visibleHooks: [],
          timelineCandidates: [],
          unresolved: [],
        },
      },
      stageStatus: { ...first.stageStatus, world: 'ready' },
    });
    await repo.saveDraft(first, first.draftRevision - 1);
    let started: TurnDraft | undefined;
    const next = await runner(async () => wire()).generate({
      ...setup(),
      draft: first,
      onDraft: (value) => {
        started = value;
      },
    });
    expect(started?.variables).toBeUndefined();
    expect(started?.world).toBeUndefined();
    expect(next.world).toBeUndefined();
    expect(next.variables?.candidateRevision).toBe(3);
    expect(next.variables?.requestRevision).toBe(3);
    expect(next.executionRevision).toBe(3);
    expect(next.story).toEqual(first.story);
    expect(next.turnId).toBe(first.turnId);
  });
  it('双开关关闭后明确补算变量，世界保持关闭，正文版本不变', async () => {
    await repo.deleteDraft('save-a', draft.draftRevision);
    const initial = createTurnDraft('save-a', 0, 'disabled', 'opening', '', false, false);
    await repo.saveDraft(initial, null);
    const disabled = rerollStory(initial, {
      turnKind: 'opening',
      narrative: text,
      summary: '',
      variableGuide: [],
    });
    await repo.saveDraft(disabled, 0);
    const settings = setup();
    settings.settings.runtime.useWorldStage = false;
    const saved = await runner(async () => wire()).generate({ ...settings, draft: disabled });
    expect(saved.useWorldStage).toBe(false);
    expect(saved.stageStatus.world).toBe('skipped');
    expect(saved.storyRevision).toBe(1);
  });
  it.each(['opening', 'regular'] as const)(
    '%s 使用各自 init/update 模块，不混用正文或世界协议',
    async (mode) => {
      await repo.deleteDraft('save-a', draft.draftRevision);
      if (mode === 'regular') {
        const completed = await completeDraft(repo, { variables: { commands: [], rejectedSuggestions: [], unresolved: [] }, world: { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] } });
        const committed = await repo.commitTurn(submission(completed));
        await repo.deleteDraft('save-a', committed.draft.draftRevision);
      }
      const initial = createTurnDraft('save-a', (await repo.load('save-a')).revision, 'existing', mode, '输入');
      await repo.saveDraft(initial, null);
      const current = rerollStory(initial, {
        turnKind: mode,
        narrative: text,
        summary: '',
        variableGuide: [],
      });
      await repo.saveDraft(current, 0);
      await runner(async () => wire()).generate({ ...setup(), draft: current });
      const ids = requestInspections.getSnapshot()[0].scope?.modules.map((m) => m.id) ?? [];
      expect(ids).toContain(`stages.${mode}.variables.text`);
      expect(ids).toContain(`variableGroups.economy.${mode === 'opening' ? 'init' : 'update'}.text`);
      expect(ids).not.toContain('shared.06_story_output');
      expect(ids).not.toContain('shared.08_world_output');
    },
  );
  it.each([
    '{not-json',
    { ...result, commands: [{ ...result.commands[0], amount: 999999 }] },
    '<命令>set unsupported.field = 1</命令>',
  ])('非法候选整批拒绝并记录安全失败元数据，不污染正文或正式状态', async (value) => {
    const before = await repo.load('save-a');
    await expect(
      runner(async () => wire(value)).generate({ ...setup(), draft }),
    ).rejects.toBeDefined();
    const failed = await repo.loadDraft('save-a');
    expect(failed?.story).toEqual(draft.story);
    expect(failed?.variables).toBeUndefined();
    expect(failed?.stageStatus.variables).toBe('failed');
    expect(failed?.failures.at(-1)).toMatchObject({
      stage: 'variables',
      storyRevision: 1,
      attempt: 1,
    });
    expect(await repo.load('save-a')).toEqual(before);
  });
  it('同页正文与变量共用锁，重复点击不发送第二个请求', async () => {
    const started = deferred<void>(),
      transport = vi.fn<typeof fetch>(async () => {
        started.resolve();
        return new Promise<Response>(() => {});
      });
    const stage = runner(transport),
      pending = stage.generate({ ...setup(), draft });
    const failed = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await started.promise;
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toMatchObject({
      code: 'STORY_BUSY',
    });
    const story = new StoryStage(repo, new AiClient(transport));
    stages.push(story);
    await expect(story.generate({ ...setup(), draft })).rejects.toMatchObject({
      code: 'STORY_BUSY',
    });
    stage.cancel();
    await failed;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('取消后新尝试成功，旧响应迟到不能覆盖新候选', async () => {
    const started = deferred<void>(),
      late = deferred<Response>();
    const stage = runner(async () => {
      started.resolve();
      return late.promise;
    });
    const pending = stage.generate({ ...setup(), draft }),
      cancelled = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await started.promise;
    stage.cancel();
    const retry = await repo.loadDraft('save-a');
    if (!retry) throw new Error('missing draft');
    const saved = await runner(async () => wire()).generate({ ...setup(), draft: retry });
    late.resolve(wire({ commands: [], rejectedSuggestions: [], unresolved: ['旧响应'] }));
    await cancelled;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await repo.loadDraft('save-a')).toEqual(saved);
  });
  it('正文 Roll 后晚到的变量回包被拒绝，不能覆盖新正文或新请求版本', async () => {
    const started = deferred<void>(),
      late = deferred<Response>();
    const pending = runner(async () => {
      started.resolve();
      return late.promise;
    }).generate({ ...setup(), draft });
    await started.promise;
    const current = await repo.loadDraft('save-a');
    if (!current) throw new Error('missing');
    const rolled = rerollStory(current, { ...draft.story!, narrative: '另一版已经保存的正文' });
    await repo.saveDraft(rolled, current.draftRevision);
    late.resolve(wire());
    await expect(pending).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadDraft('save-a')).toEqual(rolled);
  });
  it('正式 revision 改变或其它标签页新执行尝试，旧结果不能回写', async () => {
    const started = deferred<void>(),
      late = deferred<Response>();
    const pending = runner(async () => {
      started.resolve();
      return late.promise;
    }).generate({ ...setup(), draft });
    await started.promise;
    const updated = await repo.save('save-a', 0, 'external', [
      {
        type: 'SetWorldClock',
        commandId: 'external-clock',
        evidence: '已有外部合法变化',
        worldClock: '2026-10-18T09:00:00+08:00',
      },
    ]);
    late.resolve(wire());
    await expect(pending).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await repo.load('save-a')).toEqual(updated);
    expect((await repo.loadDraft('save-a'))?.variables).toBeUndefined();
  });
  it('运行中修改 UI 开关不改正在执行的配置；不自动执行世界或正式结算', async () => {
    const started = deferred<void>(),
      late = deferred<Response>(),
      settings = setup();
    const pending = runner(async () => {
      started.resolve();
      return late.promise;
    }).generate({ ...settings, draft });
    await started.promise;
    settings.settings.runtime.useVariableStage = false;
    settings.settings.runtime.useWorldStage = false;
    late.resolve(wire());
    const saved = await pending;
    expect(saved.useVariableStage).toBe(true);
    expect(saved.useWorldStage).toBe(true);
    expect(saved.world).toBeUndefined();
    expect((await repo.load('save-a')).worldClock).toBe(gameTime);
    expect((await repo.load('save-a')).appliedCommands).toEqual([]);
  });
  it('其它标签页创建新执行版本，旧回包和失败记录均不能覆盖它', async () => {
    const started = deferred<void>(),
      late = deferred<Response>();
    const pending = runner(async () => {
      started.resolve();
      return late.promise;
    }).generate({ ...setup(), draft });
    await started.promise;
    const current = await repo.loadDraft('save-a');
    if (!current) throw new Error('missing');
    const external = await repo.saveDraft(
      startStageAttempt(current, ['variables']),
      current.draftRevision,
    );
    late.resolve(wire());
    await expect(pending).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadDraft('save-a')).toEqual(external);
  });
  it('没有变量路由或开关关闭时不清空旧候选、不发请求', async () => {
    const first = await runner(async () => wire()).generate({ ...setup(), draft });
    const settings = setup(),
      transport = vi.fn<typeof fetch>(async () => wire());
    settings.config.routes.variables = { mode: 'independent', channelId: '', modelId: '' };
    await expect(runner(transport).generate({ ...settings, draft: first })).rejects.toBeDefined();
    expect(await repo.loadDraft('save-a')).toEqual(first);
    settings.settings.runtime.useVariableStage = false;
    await expect(runner(transport).generate({ ...settings, draft: first })).rejects.toBeDefined();
    expect(await repo.loadDraft('save-a')).toEqual(first);
    expect(transport).not.toHaveBeenCalled();
  });
  it('候选保存前卸载会取消事务，正文保留且没有有效变量候选', async () => {
    const stage = runner(async () => wire());
    await expect(
      stage.generate({
        ...setup(),
        draft,
        onProgress: (phase) => {
          if (phase === 'saving') stage.dispose();
        },
      }),
    ).rejects.toBeDefined();
    const saved = await repo.loadDraft('save-a');
    expect(saved?.story).toEqual(draft.story);
    expect(saved?.variables).toBeUndefined();
  });
  it('模型在命令中回显凭证也拒绝保存，失败记录不含原始响应', async () => {
    await expect(
      runner(async () => wire('<命令>set protagonist.emotionText = "mock-variable-key"</命令>')).generate({
        ...setup(),
        draft,
      }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
    expect(JSON.stringify(await repo.loadDraft('save-a'))).not.toContain('mock-variable-key');
    expect((await repo.loadDraft('save-a'))?.variables).toBeUndefined();
  });
  it('超时和权限错误只记录安全状态，不自动重试，正文仍可恢复', async () => {
    const settings = setup();
    settings.settings.runtime.timeoutSeconds = 1;
    const transport = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    await expect(runner(transport).generate({ ...settings, draft })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    const current = await repo.loadDraft('save-a');
    if (!current) throw new Error('missing');
    expect(current.failures.at(-1)?.errorCode).toBe('timeout');
    await expect(
      runner(async () => new Response('mock-variable-key 原始错误', { status: 403 })).generate({
        ...setup(),
        draft: current,
      }),
    ).rejects.toMatchObject({ code: 'authorization' });
    expect(JSON.stringify(await repo.loadDraft('save-a'))).not.toContain('mock-variable-key');
  });
});
