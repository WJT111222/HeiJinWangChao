import { completeDraft, submission } from './fixtures/turn';
import { variableReply } from './fixtures/variableReply';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { AiStage } from '../services/ai/configuration';
import { requestInspections } from '../services/ai/inspection';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { TurnCoordinator, transientStageError } from '../workflows/turnCoordinator';
import type { TurnProgress } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import { VariableStage } from '../workflows/variableStage';
import { WorldStage } from '../workflows/worldStage';
import { worldState, worldDraft, worldResult, npcUpdate, worldNarrative } from './fixtures/world';

const stages: AiStage[] = ['story', 'variables', 'world'];
function setup() {
  const config = defaultAiConfig(),
    channel = newChannel();
  channel.baseUrl = 'https://coordinator.mock.invalid/v1';
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const values = new Map<string, string>();
  const store = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'mock-turn-key');
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 5;
  settings.prompts.actionOptions = false;
  return { config, vault, settings };
}
function wire(stage: AiStage, invalid = false, expectedRevision = 0) {
  const text = invalid
    ? '{bad'
    : stage === 'story'
      ? `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${worldNarrative}</正文><短期记忆>用餐</短期记忆><变量规划>[]</变量规划>`
      : (stage === 'variables' ? variableReply(worldDraft().variables!.result) : JSON.stringify(worldResult([{ ...npcUpdate(), expectedRevision }])));
  return stage === 'story'
    ? new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    : Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
}
function model(init?: RequestInit): AiStage {
  const body: unknown = JSON.parse(String(init?.body));
  if (
    !body ||
    typeof body !== 'object' ||
    !('model' in body) ||
    !stages.includes(body.model as AiStage)
  )
    throw new Error('missing model');
  return body.model as AiStage;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
let repo: SaveRepository, draft: TurnDraft;
const runners: TurnCoordinator[] = [];
function runner(
  fetcher: typeof fetch,
  repository: ConstructorParameters<typeof TurnCoordinator>[0] = repo,
) {
  const value = new TurnCoordinator(repository, new AiClient(fetcher));
  runners.push(value);
  return value;
}
async function currentDraft() {
  const current = await repo.loadDraft('save-a');
  if (!current) throw new Error('draft missing');
  return current;
}
beforeEach(async () => {
  repo = await SaveRepository.open('coordinator', new IDBFactory());
  await repo.create(worldState());
  draft = createTurnDraft('save-a', 0, 'turn-a', 'opening', '');
  await repo.saveDraft(draft, null);
  requestInspections.clear();
});
afterEach(() => {
  runners.splice(0).forEach((r) => r.dispose());
  repo.close();
  vi.restoreAllMocks();
});

describe('真实三阶段顺序协调及恢复，正式 GameState 不变', () => {
  it.each(['opening', 'regular'] as const)(
    '%s 独立主提示词、最新变量投影、全部保存，不重复付费',
    async (mode) => {
      await repo.deleteDraft('save-a', 0);
      if (mode === 'regular') {
        const completed = await completeDraft(repo, { variables: { commands: [], rejectedSuggestions: [], unresolved: [] }, world: { worldCommands: [], taskCommands: [], eventCommands: [], futureEvents: [], visibleHooks: [], timelineCandidates: [], unresolved: [] } });
        const committed = await repo.commitTurn(submission(completed));
        await repo.deleteDraft('save-a', committed.draft.draftRevision);
      }
      const formal=await repo.load('save-a');
      draft = createTurnDraft('save-a', formal.revision, 'turn-a', mode, '');
      await repo.saveDraft(draft, null);
      const before = await repo.load('save-a'),
        calls: AiStage[] = [],
        progress: TurnProgress[] = [];
      const transport = vi.fn<typeof fetch>(async (_url, init) => {
        const stage = model(init);
        calls.push(stage);
        if (stage === 'variables') expect((await currentDraft()).stageStatus.story).toBe('ready');
        if (stage === 'world') expect((await currentDraft()).stageStatus.variables).toBe('ready');
        return wire(stage, false, formal.revision);
      });
      const coordinator = runner(transport),
        input = setup();
      const outcome = await coordinator.generate({
        ...input,
        draft,
        onProgress: (p) => progress.push(p),
      });
      expect(calls).toEqual(stages);
      expect(outcome.status).toBe('complete');
      expect(outcome.draft.stageStatus).toEqual({
        story: 'ready',
        variables: 'ready',
        world: 'ready',
      });
      expect(outcome.draft.world?.basedOnVariableRevision).toBe(
        outcome.draft.variables?.candidateRevision,
      );
      expect(await repo.load('save-a')).toEqual(before);
      for (const stage of stages) {
        const inspection = requestInspections.getSnapshot().find((r) => r.stage === stage)!;
        expect(inspection.scope?.modules.some((m) => m.id === `stages.${mode}.${stage}${stage === 'variables' ? '.text' : ''}`)).toBe(
          true,
        );
        expect(
          inspection.scope?.modules.some((m) =>
            m.id.startsWith(`stages.${mode === 'opening' ? 'regular' : 'opening'}.`),
          ),
        ).toBe(false);
        expect(progress.some((p) => p.stage === stage && p.phase === 'saving')).toBe(true);
      }
      const world = requestInspections.getSnapshot().find((r) => r.stage === 'world')!;
      expect(JSON.stringify(world.messages).includes('TIME_WINDOW')).toBe(true);
      expect(JSON.stringify(world.messages)).toContain('2026-10-18T08:10:00+08:00');
      const again = await coordinator.generate({
        ...input,
        draft: outcome.draft,
        config: defaultAiConfig(),
      });
      expect(again.status).toBe('complete');
      expect(calls).toEqual(stages);
    },
  );
  it.each(stages)('%s 失败后保留上游，停止下游，刷新草稿后从失败阶段恢复', async (failedStage) => {
    const before = await repo.load('save-a'),
      calls: AiStage[] = [];
    let bad = true;
    const coordinator = runner(async (_url, init) => {
        const stage = model(init);
        calls.push(stage);
        return wire(stage, stage === failedStage && bad);
      }),
      input = setup();
    await expect(coordinator.generate({ ...input, draft })).rejects.toMatchObject({
      code: failedStage === 'story' ? 'invalid_output' : failedStage === 'variables' ? 'variable_text_syntax' : 'invalid_json',
    });
    const failed = await currentDraft();
    expect(calls).toEqual(stages.slice(0, stages.indexOf(failedStage) + 1));
    if (failedStage !== 'story') expect(failed.story?.narrative).toBe(worldNarrative);
    if (failedStage === 'world') expect(failed.variables?.validation).toBe('validated');
    expect(await repo.load('save-a')).toEqual(before);
    bad = false;
    calls.length = 0;
    const result = await coordinator.generate({ ...input, draft: failed });
    expect(result.status).toBe('complete');
    expect(calls).toEqual(stages.slice(stages.indexOf(failedStage)));
    expect(await repo.load('save-a')).toEqual(before);
  });
  it.each(stages)('%s 瞬时服务错误只自动重试一次，重复失败后停止', async (failedStage) => {
    const counts = { story: 0, variables: 0, world: 0 },
      progress: TurnProgress[] = [];
    const coordinator = runner(async (_url, init) => {
      const stage = model(init);
      counts[stage]++;
      return stage === failedStage ? new Response('', { status: 503 }) : wire(stage);
    });
    await expect(
      coordinator.generate({ ...setup(), draft, onProgress: (p) => progress.push(p) }),
    ).rejects.toMatchObject({ code: 'server' });
    expect(counts[failedStage]).toBe(2);
    expect(progress.filter((p) => p.phase === 'retrying')).toHaveLength(1);
    for (const later of stages.slice(stages.indexOf(failedStage) + 1))
      expect(counts[later]).toBe(0);
  });
  it('503 后重试成功并继续，不重复上游', async () => {
    const calls: AiStage[] = [];
    const coordinator = runner(async (_url, init) => {
      const stage = model(init);
      calls.push(stage);
      return stage === 'variables' && calls.filter((s) => s === stage).length === 1
        ? new Response('', { status: 502 })
        : wire(stage);
    });
    expect((await coordinator.generate({ ...setup(), draft })).status).toBe('complete');
    expect(calls).toEqual(['story', 'variables', 'variables', 'world']);
    expect((await currentDraft()).failures).toMatchObject([
      { stage: 'variables', errorCode: 'server' },
    ]);
  });
  it.each([401, 403, 404, 429, 501])('HTTP %i 不盲目重试', async (status) => {
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status }));
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('网络/CORS/超时等不确定错误和 retryable 字样不等于可自动重试', async () => {
    for (const code of [
      'network',
      'timeout',
      'stream_interrupted',
      'invalid_json',
      'authorization',
    ] as const)
      expect(transientStageError(new AiError(code))).toBe(false);
    const transport = vi.fn<typeof fetch>(async () => {
      throw new TypeError('CORS');
    });
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toMatchObject({
      code: 'network',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['variables', 'world'] as const)('下游 %s 配置缺失，在首次付费前拒绝', async (stage) => {
    const input = setup();
    input.config.routes[stage] = { mode: 'independent', channelId: '', modelId: '' };
    const transport = vi.fn<typeof fetch>();
    await expect(runner(transport).generate({ ...input, draft })).rejects.toMatchObject({
      code: 'configuration',
    });
    expect(transport).not.toHaveBeenCalled();
    expect(await currentDraft()).toEqual(draft);
  });
  it('下游凭证缺失提前拒绝', async () => {
    const input = setup(),
      other = newChannel();
    input.config.channels.push(other);
    input.config.routes.world = { mode: 'independent', channelId: other.id, modelId: 'world' };
    const transport = vi.fn<typeof fetch>();
    await expect(runner(transport).generate({ ...input, draft })).rejects.toMatchObject({
      code: 'credentials',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ] as const)(
    '独立开关 variables=%s/world=%s，不偷偷请求',
    async (useVariableStage, useWorldStage) => {
      const input = setup();
      Object.assign(input.settings.runtime, { useVariableStage, useWorldStage });
      const calls: AiStage[] = [];
      const coordinator = runner(async (_url, init) => {
        const stage = model(init);
        calls.push(stage);
        return stage === 'world'
          ? Response.json({
              choices: [
                { message: { content: JSON.stringify(worldResult()) }, finish_reason: 'stop' },
              ],
            })
          : wire(stage);
      });
      const result = await coordinator.generate({ ...input, draft });
      expect(calls).toEqual([
        'story',
        ...(useVariableStage ? ['variables'] : []),
        ...(useWorldStage ? ['world'] : []),
      ]);
      expect(result.status).toBe(useWorldStage ? 'preview' : 'skipped');
      expect((await coordinator.generate({ ...input, draft: result.draft })).status).not.toBe(
        'complete',
      );
      expect(calls).toHaveLength(useWorldStage || useVariableStage ? 2 : 1);
    },
  );
  it('已合法变量在关闭变量开关时仍可供世界复用', async () => {
    const input = setup();
    input.settings.runtime.useWorldStage = false;
    const coordinator = runner(async (_url, init) => wire(model(init)));
    const partial = await coordinator.generate({ ...input, draft });
    input.settings.runtime.useVariableStage = false;
    input.settings.runtime.useWorldStage = true;
    const final = await coordinator.generate({ ...input, draft: partial.draft });
    expect(final.draft.world?.validation).toBe('validated');
    expect(final.draft.variables).toEqual(partial.draft.variables);
    expect(final.status).toBe('skipped');
  });
});

describe('会话互斥、取消、版本与配置快照', () => {
  it('整个会话排斥同存档其他工作流及手动 Stage，跨阶段无嵌套锁冲突', async () => {
    const hold = deferred<Response>(),
      entered = deferred<void>(),
      input = setup();
    const first = runner(async (_url, init) => {
      if (model(init) === 'story') {
        entered.resolve();
        return hold.promise;
      }
      return wire(model(init));
    });
    const running = first.generate({ ...input, draft });
    await entered.promise;
    await expect(
      runner(async () => wire('story')).generate({ ...input, draft }),
    ).rejects.toMatchObject({ code: 'STORY_BUSY' });
    const client = new AiClient(async () => wire('story'));
    for (const stage of [
      new StoryStage(repo, client),
      new VariableStage(repo, client),
      new WorldStage(repo, client),
    ])
      await expect(stage.generate({ ...input, draft })).rejects.toMatchObject({
        code: 'STORY_BUSY',
      });
    hold.resolve(wire('story'));
    expect((await running).status).toBe('complete');
  });
  it.each(stages)(
    '取消 %s 后不执行下游，保留上游，迟到响应不能污染新会话',
    async (cancelledStage) => {
      const hold = deferred<Response>(),
        entered = deferred<void>(),
        input = setup();
      const before = await repo.load('save-a');
      const coordinator = runner(async (_url, init) => {
        if (model(init) === cancelledStage) {
          entered.resolve();
          return hold.promise;
        }
        return wire(model(init));
      });
      const pending = coordinator.generate({ ...input, draft });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      await entered.promise;
      expect(coordinator.cancel()).toBe(true);
      await rejected;
      const cancelled = await currentDraft();
      if (cancelledStage !== 'story') expect(cancelled.story).toBeDefined();
      if (cancelledStage === 'world') expect(cancelled.variables).toBeDefined();
      const next = runner(async (_url, init) => wire(model(init)));
      const recovered = await next.generate({ ...input, draft: cancelled });
      hold.resolve(wire(cancelledStage));
      await Promise.resolve();
      expect(await currentDraft()).toEqual(recovered.draft);
      expect(await repo.load('save-a')).toEqual(before);
    },
  );
  it('保存不可中断时取消返回 false，不虚报取消成功', async () => {
    const hold = deferred<void>(),
      entered = deferred<void>();
    const repository = {
      load: repo.load.bind(repo),
      loadDraft: repo.loadDraft.bind(repo),
      saveDraft: async (...args: Parameters<SaveRepository['saveDraft']>) => {
        if (args[0].story) {
          entered.resolve();
          await hold.promise;
        }
        return repo.saveDraft(...args);
      },
    };
    const input = setup();
    input.settings.runtime.useVariableStage = false;
    input.settings.runtime.useWorldStage = false;
    const coordinator = runner(async (_url, init) => wire(model(init)), repository);
    const pending = coordinator.generate({ ...input, draft });
    await entered.promise;
    expect(coordinator.cancel()).toBe(false);
    hold.resolve();
    expect((await pending).draft.story).toBeDefined();
  });
  it.each(['draft', 'formal', 'reroll'] as const)(
    '跨标签页 %s 变化拒绝旧响应且不重试',
    async (change) => {
      const hold = deferred<Response>(),
        entered = deferred<void>(),
        input = setup();
      const transport = vi.fn<typeof fetch>(async () => {
        entered.resolve();
        return hold.promise;
      });
      const pending = runner(transport).generate({ ...input, draft });
      const rejected = expect(pending).rejects.toThrow();
      await entered.promise;
      if (change === 'formal')
        await repo.save('save-a', 0, 'other-turn', [
          {
            type: 'SetWorldClock',
            commandId: 'other-clock',
            evidence: '一分钟过去了',
            worldClock: '2026-10-18T08:01:00+08:00',
          },
        ]);
      else
        await repo.saveDraft(
          rerollStory(draft, { ...worldDraft().story!, turnKind: 'opening' }),
          0,
        );
      const stored = await currentDraft();
      hold.resolve(wire('story'));
      await rejected;
      expect(await currentDraft()).toEqual(stored);
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it('重试前取消会话不会再次请求', async () => {
    const input = setup(),
      transport = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    const coordinator = runner(transport);
    await expect(
      coordinator.generate({
        ...input,
        draft,
        onProgress: (p) => {
          if (p.phase === 'retrying') coordinator.dispose();
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('服务错误重试前重新核验版本，不接纳其他标签的新正文', async () => {
    let latest = draft;
    let changed: Promise<TurnDraft> | undefined;
    const input = setup();
    const transport = vi.fn<typeof fetch>(async (_url, init) =>
      model(init) === 'variables' ? new Response('', { status: 503 }) : wire('story'),
    );
    await expect(
      runner(transport).generate({
        ...input,
        draft,
        onDraft: (next) => {
          latest = next;
        },
        onProgress: (p) => {
          if (p.phase === 'retrying')
            changed = repo.saveDraft(
              rerollStory(latest, {
                ...latest.story!,
                narrative: '其他标签选定的新正文',
              }),
              latest.draftRevision,
            );
        },
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect((await changed)?.story?.narrative).toBe('其他标签选定的新正文');
    expect(transport).toHaveBeenCalledTimes(2);
    expect((await currentDraft()).variables).toBeUndefined();
  });
  it('上游刚保存时取消阻止下游，成功保存的正文保持可恢复', async () => {
    const transport = vi.fn<typeof fetch>(async (_url, init) => wire(model(init)));
    const coordinator = runner(transport);
    await expect(
      coordinator.generate({
        ...setup(),
        draft,
        onDraft: () => {
          coordinator.cancel();
        },
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await currentDraft()).stageStatus.story).toBe('ready');
    expect((await currentDraft()).variables).toBeUndefined();
  });
  it('手动阶段持锁时协调器拒绝启动，释放后仍可正常执行', async () => {
    const hold = deferred<Response>(),
      entered = deferred<void>(),
      input = setup();
    const manual = new StoryStage(
      repo,
      new AiClient(async () => {
        entered.resolve();
        return hold.promise;
      }),
    );
    const pending = manual.generate({ ...input, draft });
    await entered.promise;
    const coordinator = runner(async (_url, init) => wire(model(init)));
    await expect(coordinator.generate({ ...input, draft })).rejects.toMatchObject({
      code: 'STORY_BUSY',
    });
    hold.resolve(wire('story'));
    const ready = await pending;
    expect((await coordinator.generate({ ...input, draft: ready })).status).toBe('complete');
  });
  it('阶段衔接的保存回调中手动请求仍被会话所有权阻止', async () => {
    const input = setup();
    const manual = new StoryStage(repo, new AiClient(async () => wire('story')));
    const conflicts: Promise<unknown>[] = [];
    const result = await runner(async (_url, init) => wire(model(init))).generate({
      ...input,
      draft,
      onDraft: (next) => {
        conflicts.push(
          expect(manual.generate({ ...input, draft: next })).rejects.toMatchObject({
            code: 'STORY_BUSY',
          }),
        );
      },
    });
    await Promise.all(conflicts);
    expect(result.status).toBe('complete');
  });
  it('设置、路由和凭证在正文生成中改变，后续仍用启动快照', async () => {
    const input = setup(),
      calls: AiStage[] = [],
      keys: string[] = [];
    const coordinator = runner(async (_url, init) => {
      const stage = model(init);
      calls.push(stage);
      keys.push(new Headers(init?.headers).get('authorization') ?? '');
      if (stage === 'story') {
        input.settings.runtime.useVariableStage = false;
        input.settings.runtime.useWorldStage = false;
        input.config.routes.variables = { mode: 'follow-story' };
        input.vault.delete(input.config.channels[0].id);
      }
      return wire(stage);
    });
    expect((await coordinator.generate({ ...input, draft })).status).toBe('complete');
    expect(calls).toEqual(stages);
    expect(keys).toEqual(Array(3).fill('Bearer mock-turn-key'));
  });
  it('重新 Roll 显式使旧变量与世界候选失效，之后自动执行只补下游', async () => {
    const input = setup(),
      calls: AiStage[] = [];
    const coordinator = runner(async (_url, init) => {
      const s = model(init);
      calls.push(s);
      return wire(s);
    });
    const first = await coordinator.generate({ ...input, draft });
    const rerolled = await new StoryStage(repo, new AiClient(async () => wire('story'))).generate({
      ...input,
      draft: first.draft,
    });
    expect(rerolled.variables).toBeUndefined();
    expect(rerolled.world).toBeUndefined();
    calls.length = 0;
    expect((await coordinator.generate({ ...input, draft: rerolled })).status).toBe('complete');
    expect(calls).toEqual(['variables', 'world']);
  });
});
