import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { WorldStage } from '../workflows/worldStage';
import { VariableStage } from '../workflows/variableStage';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { createTurnDraft, rerollStory, startStageAttempt } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { requestInspections } from '../services/ai/inspection';
import { worldState, worldDraft, worldResult, npcUpdate, proof } from './fixtures/world';
import { gameTime, task, event } from './fixtures/game';
function setup(protocol: Protocol = 'openai') {
  const config = defaultAiConfig(),
    story = newChannel(),
    world = { ...newChannel(protocol), defaultModel: 'world-only' };
  config.channels = [story, world];
  config.routes.story = { channelId: story.id, modelId: 'story-only' };
  config.routes.world = { mode: 'independent', channelId: world.id, modelId: '' };
  const values = new Map<string, string>(),
    store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  const vault = new CredentialVault(store, store);
  config.channels.forEach((c) => vault.set(c.id, 'mock-world-secret'));
  return { config, vault, settings: defaultSettings() };
}
function wire(value: unknown = worldResult([npcUpdate()]), protocol: Protocol = 'openai') {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Response.json(
    protocol === 'openai'
      ? {
          choices: [{ message: { content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        }
      : protocol === 'gemini'
        ? { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }
        : { content: [{ type: 'text', text }], stop_reason: 'end_turn' },
  );
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let repo: SaveRepository, draft: TurnDraft;
const stages: WorldStage[] = [];
function runner(
  fetcher: typeof fetch,
  repository: ConstructorParameters<typeof WorldStage>[0] = repo,
) {
  const stage = new WorldStage(repository, new AiClient(fetcher));
  stages.push(stage);
  return stage;
}
beforeEach(async () => {
  repo = await SaveRepository.open('world-stage', new IDBFactory());
  await repo.create(worldState());
  const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '');
  await repo.saveDraft(initial, null);
  const ready = worldDraft();
  const story = rerollStory(initial, ready.story!);
  await repo.saveDraft(story, 0);
  draft = await repo.saveDraft({ ...ready, draftRevision: 2 }, 1);
  requestInspections.clear();
});
afterEach(() => {
  stages.splice(0).forEach((s) => s.dispose());
  repo.close();
  vi.restoreAllMocks();
});

describe('世界阶段实际 Runtime → 候选，不提交正式状态', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 复用真实路由/模块/版本/草稿原子保存',
    async (protocol) => {
      const before = await repo.load('save-a'),
        transport = vi.fn<typeof fetch>(async () => wire(undefined, protocol));
      const saved = await runner(transport).generate({ ...setup(protocol), draft });
      expect(saved.story).toEqual(draft.story);
      expect(saved.variables).toEqual(draft.variables);
      expect(saved.world).toMatchObject({
        validation: 'validated',
        storyRevision: 1,
        basedOnVariableRevision: 1,
        requestRevision: 1,
        candidateRevision: 1,
      });
      expect(saved.stageStatus.world).toBe('ready');
      expect(saved.executionRevision).toBe(1);
      expect(saved.draftRevision).toBe(4);
      expect(await repo.loadDraft('save-a')).toEqual(saved);
      expect(await repo.load('save-a')).toEqual(before);
      const [inspection] = requestInspections.getSnapshot();
      expect(inspection.stage).toBe('world');
      expect(inspection.route.model).toBe('world-only');
      expect(inspection.scope?.modules.some((m) => m.id === 'stages.regular.world')).toBe(true);
      expect(inspection.scope?.modules.filter((m) => m.id.endsWith('.offscreen'))).toHaveLength(9);
      expect(JSON.stringify(inspection)).not.toContain('mock-world-secret');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('关闭变量时复用已有合法变量，不转成预览；重生成不 Roll、不丢变量', async () => {
    const options = setup();
    options.settings.runtime.useVariableStage = false;
    const stage = runner(async () => wire());
    const first = await stage.generate({ ...options, draft });
    const second = await stage.generate({ ...options, draft: first });
    expect(second.world?.validation).toBe('validated');
    expect(second.world?.candidateRevision).toBeGreaterThan(first.world!.candidateRevision);
    expect(second.variables).toEqual(draft.variables);
    expect(second.story).toEqual(draft.story);
    expect(second.useVariableStage).toBe(false);
  });
  it('缺少合法变量只能预览；双关闭后可以只开启世界，正文保留', async () => {
    await repo.deleteDraft('save-a', draft.draftRevision);
    const initial = createTurnDraft('save-a', 0, 'turn-a', 'regular', '', false, false);
    await repo.saveDraft(initial, null);
    const ready = rerollStory(initial, draft.story!);
    await repo.saveDraft(ready, 0);
    const options = setup();
    options.settings.runtime.useVariableStage = false;
    const result = worldResult([
      {
        ...npcUpdate({}),
        activeGoals: ['整理明日排班'],
        evidence: proof({ kind: 'planned', at: gameTime }),
      },
    ]);
    const saved = await runner(async () => wire(result)).generate({ ...options, draft: ready });
    expect(saved.world?.validation).toBe('preview');
    expect(saved.stageStatus.world).toBe('preview');
    expect(saved.world?.basedOnVariableRevision).toBeUndefined();
    expect(saved.story).toEqual(ready.story);
    expect(saved.variables).toBeUndefined();
  });
  it('开局使用 opening 世界主提示词', async () => {
    await repo.deleteDraft('save-a', draft.draftRevision);
    const init = createTurnDraft('save-a', 0, 'turn-a', 'opening', '');
    await repo.saveDraft(init, null);
    const ready = rerollStory(init, { ...draft.story!, turnKind: 'opening' });
    await repo.saveDraft(ready, 0);
    await runner(async () => wire(worldResult())).generate({ ...setup(), draft: ready });
    expect(
      requestInspections
        .getSnapshot()[0]
        .scope?.modules.some((m) => m.id === 'stages.opening.world'),
    ).toBe(true);
  });
  it('正文不完整、开关关闭、过期版本与缺少路由不发请求', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => wire()),
      stage = runner(fetcher),
      options = setup();
    await expect(
      stage.generate({ ...options, draft: { ...draft, draftRevision: 99 } }),
    ).rejects.toBeDefined();
    options.settings.runtime.useWorldStage = false;
    await expect(stage.generate({ ...options, draft })).rejects.toBeDefined();
    options.settings.runtime.useWorldStage = true;
    options.config.routes.world = { mode: 'independent', channelId: 'missing', modelId: '' };
    await expect(stage.generate({ ...options, draft })).rejects.toBeDefined();
    await repo.deleteDraft('save-a', draft.draftRevision);
    const pending = createTurnDraft('save-a', 0, 'turn-a', 'regular', '');
    await repo.saveDraft(pending, null);
    await expect(stage.generate({ ...setup(), draft: pending })).rejects.toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await repo.loadDraft('save-a')).toEqual(pending);
  });
  it('已标记 validated 但证据不合法的变量在网络之前拒绝', async () => {
    const corrupted = {
      ...draft,
      draftRevision: 3,
      variables: {
        ...draft.variables!,
        result: {
          ...draft.variables!.result,
          commands: [{ ...draft.variables!.result.commands[0], evidence: '凭空推进时间' }],
        },
      },
    };
    // 模拟持久化外部损坏；正常 saveDraft 本身也保持版本限制。
    const transport = vi.fn<typeof fetch>(async () => wire());
    await expect(
      runner(transport, {
        load: repo.load.bind(repo),
        loadDraft: async () => corrupted,
        saveDraft: repo.saveDraft.bind(repo),
      }).generate({ ...setup(), draft: corrupted }),
    ).rejects.toBeDefined();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    '{bad',
    worldResult([{ ...npcUpdate(), npcId: 'scene' }]),
    { ...worldResult(), unresolved: ['mock-world-secret'] },
  ])('错误 JSON/越权/凭证回显不产生候选 %#', async (value) => {
    const before = await repo.load('save-a');
    await expect(
      runner(async () => wire(value)).generate({ ...setup(), draft }),
    ).rejects.toBeDefined();
    const saved = await repo.loadDraft('save-a');
    expect(saved?.world).toBeUndefined();
    expect(saved?.stageStatus.world).toBe('failed');
    expect(saved?.story).toEqual(draft.story);
    expect(saved?.variables).toEqual(draft.variables);
    expect(await repo.load('save-a')).toEqual(before);
  });
  it('网络中断记录可恢复阶段状态，正文保留', async () => {
    await expect(
      runner(async () => {
        throw new TypeError('network');
      }).generate({ ...setup(), draft }),
    ).rejects.toBeDefined();
    expect((await repo.loadDraft('save-a'))?.failures.at(-1)).toMatchObject({
      stage: 'world',
      storyRevision: 1,
      retryable: true,
    });
  });
});

describe('二轮审查错误通过真实 Runtime 安全失败', () => {
  it.each(['event-result', 'npc-quota'] as const)(
    '%s 不污染正文、变量或正式对象，保留明确错误码',
    async (scenario) => {
      const before = await repo.load('save-a'),
        result = worldResult();
      if (scenario === 'event-result')
        result.eventCommands = [
          {
            type: 'SaveEvent',
            commandId: 'premature',
            event: {
              ...event(),
              actorRefs: [{ kind: 'npc', id: 'npc-a' }],
              resolutionText: '未来行动已经成功',
            },
            evidence: proof({ kind: 'planned' }),
          },
        ];
      else
        result.taskCommands = ['a', 'b'].map((id) => ({
          type: 'SaveTask',
          commandId: `job-${id}`,
          task: { ...task(id), goal: `清点器材 ${id}`, actorRef: { kind: 'npc', id: 'npc-a' } },
          evidence: proof({ kind: 'planned' }),
        }));
      await expect(
        runner(async () => wire(result)).generate({ ...setup(), draft }),
      ).rejects.toMatchObject({
        code: scenario === 'event-result' ? 'invalid_output' : 'npc_task_conflict',
      });
      const saved = await repo.loadDraft('save-a');
      expect(saved?.world).toBeUndefined();
      expect(saved?.stageStatus.world).toBe('failed');
      expect(saved?.story).toEqual(draft.story);
      expect(saved?.variables).toEqual(draft.variables);
      expect(saved?.failures.at(-1)?.errorCode).toBe(
        scenario === 'event-result' ? 'invalid_output' : 'npc_task_conflict',
      );
      expect(await repo.load('save-a')).toEqual(before);
    },
  );
});

describe('世界并发、迟到与取消', () => {
  async function pending() {
    const response = deferred<Response>(),
      started = deferred<TurnDraft>();
    const stage = runner(() => response.promise),
      options = setup();
    const result = stage.generate({
      ...options,
      draft,
      onDraft: (value) => started.resolve(value),
    });
    const caught = result.then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    const active = await started.promise;
    await vi.waitFor(() => expect(requestInspections.getSnapshot()).toHaveLength(1));
    return { response, stage, options, result: caught, active };
  }
  it('取消并开始新尝试，旧请求即使忽略 abort 也不能覆盖新候选', async () => {
    const old = await pending();
    expect(old.stage.cancel()).toBe(true);
    const current = await repo.loadDraft('save-a');
    const fresh = await runner(async () => wire(worldResult())).generate({
      ...setup(),
      draft: current!,
    });
    old.response.resolve(wire());
    expect((await old.result).error).toBeDefined();
    expect(await repo.loadDraft('save-a')).toEqual(fresh);
    expect(fresh.world?.result.worldCommands).toHaveLength(0);
  });
  it.each(['story', 'variables', 'world-request', 'formal', 'delete'] as const)(
    '%s 跨标签页更新后旧响应被拒绝',
    async (mode) => {
      const old = await pending();
      if (mode === 'story')
        await repo.saveDraft(rerollStory(old.active, old.active.story!), old.active.draftRevision);
      if (mode === 'variables')
        await repo.saveDraft(
          startStageAttempt(old.active, ['variables']),
          old.active.draftRevision,
        );
      if (mode === 'world-request')
        await repo.saveDraft(startStageAttempt(old.active, ['world']), old.active.draftRevision);
      if (mode === 'formal')
        await repo.save('save-a', 0, 'other-turn', [
          {
            type: 'SpendFunds',
            commandId: 'other-meal',
            account: 'cash',
            amount: 1,
            purpose: '并发变更',
            evidence: '测试',
          },
        ]);
      if (mode === 'delete') await repo.delete('save-a', 0);
      const latest = await repo.loadDraft('save-a').catch(() => undefined);
      old.response.resolve(wire());
      expect((await old.result).error).toBeDefined();
      expect(await repo.loadDraft('save-a').catch(() => undefined)).toEqual(latest);
    },
  );
  it('共享 StageGuard 阻止同一存档世界/变量同时请求', async () => {
    const old = await pending(),
      transport = vi.fn<typeof fetch>(async () => wire());
    const variables = new VariableStage(repo, new AiClient(transport));
    await expect(variables.generate({ ...setup(), draft: old.active })).rejects.toBeDefined();
    expect(transport).not.toHaveBeenCalled();
    variables.dispose();
    old.stage.cancel();
    old.response.resolve(wire());
    await old.result;
  });
  it('运行中的配置快照不随调用方修改而变化', async () => {
    const old = await pending();
    old.options.settings.runtime.useVariableStage = false;
    old.options.settings.runtime.useWorldStage = false;
    old.options.config.routes.world = { mode: 'independent', channelId: 'bad', modelId: '' };
    old.response.resolve(wire());
    const result = await old.result;
    expect(result.value?.useVariableStage).toBe(true);
    expect(result.value?.useWorldStage).toBe(true);
    expect(requestInspections.getSnapshot()[0].route.model).toBe('world-only');
  });
  it('保存失败不会留下部分世界候选', async () => {
    const before = await repo.load('save-a'),
      save = repo.saveDraft.bind(repo);
    const stage = runner(async () => wire(), {
      load: repo.load.bind(repo),
      loadDraft: repo.loadDraft.bind(repo),
      saveDraft: async (next, revision, signal) => {
        if (next.world) throw new Error('模拟配额失败');
        return save(next, revision, signal);
      },
    });
    await expect(stage.generate({ ...setup(), draft })).rejects.toBeDefined();
    expect((await repo.loadDraft('save-a'))?.world).toBeUndefined();
    expect(await repo.load('save-a')).toEqual(before);
  });
});
