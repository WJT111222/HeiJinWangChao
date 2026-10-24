import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { StoryStage, storyError } from '../workflows/storyStage';
import { StoryStream } from '../workflows/storyStream';
import { SaveRepository } from '../services/storage/saveRepository';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestInspections } from '../services/ai/inspection';
import { createTurnDraft, rerollStory, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

const narrative = '【旁白】街边的公交车缓缓驶过。\n\n你看着窗外的路灯，没有作出决定。';
function output(body = narrative, actions = true) {
  return `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${body}</正文><短期记忆>等车</短期记忆><变量规划>[{"group":"time","observedFact":"公交车驶过"}]</变量规划>${actions ? '<行动选项>留在原地\n看看周围\n询问站台</行动选项>' : ''}`;
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
function sse(text: string, protocol: Protocol = 'openai') {
  // 每个 delta 一个 UTF-16 代码单元，网络再按单字节拆，覆盖标签与中文边界。
  const deltas = text
    .split('')
    .map((text) =>
      frame(
        protocol === 'openai'
          ? { choices: [{ delta: { content: text } }] }
          : protocol === 'gemini'
            ? { candidates: [{ content: { parts: [{ text }] } }] }
            : { type: 'content_block_delta', delta: { type: 'text_delta', text } },
      ),
    )
    .join('');
  const terminal =
    protocol === 'openai'
      ? frame({
          choices: [],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        }) + 'data: [DONE]\n\n'
      : protocol === 'gemini'
        ? frame({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 42 } })
        : frame({ type: 'message_delta', usage: { output_tokens: 7 } }) +
          frame({ type: 'message_stop' });
  const bytes = new TextEncoder().encode(deltas + terminal);
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(index, ++index));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
function setup(protocol: Protocol = 'openai') {
  const channel = { ...newChannel(protocol), defaultModel: 'story-mock' };
  const config = defaultAiConfig();
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '' };
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
  vault.set(channel.id, 'mock-story-secret');
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 10;
  return { config, vault, settings };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let repo: SaveRepository;
let draft: TurnDraft;
const runners: StoryStage[] = [];
function runner(transport: typeof fetch, repository = repo) {
  const stage = new StoryStage(repository, new AiClient(transport));
  runners.push(stage);
  return stage;
}
beforeEach(async () => {
  repo = await SaveRepository.open('story-tests', new IDBFactory());
  const state = await repo.create(game());
  draft = createTurnDraft(state.saveId, state.revision, 'opening-test', 'opening', '', false, true);
  await repo.saveDraft(draft, null);
  requestInspections.clear();
});
afterEach(() => {
  runners.splice(0).forEach((stage) => stage.dispose());
  repo.close();
  vi.restoreAllMocks();
});
describe('正文流式阅读投影', () => {
  it('任意拆分、换行与正文片段只追加一次，永不显示尾部 JSON、标签或短期记忆', () => {
    const text = output();
    for (let split = 0; split <= text.length; split++) {
      const stream = new StoryStream();
      const first = stream.push(text.slice(0, split));
      expect(narrative.startsWith(first)).toBe(true);
      expect(stream.push(text.slice(split))).toBe(narrative);
      expect(stream.push('迟到片段')).toBe(narrative);
    }
    const stream = new StoryStream();
    for (const ch of text) expect(narrative.startsWith(stream.push(ch))).toBe(true);
  });
  it('不接受前置思考、错误前缀，缺失闭合标签时也不展示内部块', () => {
    for (const prefix of ['<think>秘密</think>', '错误前缀'])
      expect(new StoryStream().push(prefix + output())).toBe('');
    const stream = new StoryStream();
    expect(stream.push('<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>可见<变量规')).toBe('可见');
    expect(stream.push('划>[{"内部":1}]')).toBe('可见');
  });
});
describe('真实正文入口与草稿原子替换', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 使用真实 SSE/Composer/parseStory 保存开局，正式存档字节不变',
    async (protocol) => {
      const before = await repo.load(draft.saveId);
      const visible: string[] = [];
      const client = vi.fn<typeof fetch>(async () => sse(output(), protocol));
      const saved = await runner(client).generate({
        ...setup(protocol),
        draft,
        onProgress: (value) => visible.push(value.narrative),
      });
      expect(saved.story).toMatchObject({
        narrative,
        summary: '等车',
        actionOptions: ['留在原地', '看看周围', '询问站台'],
      });
      expect(saved.storyRevision).toBe(1);
      expect(saved.draftRevision).toBe(1);
      expect(saved.turnId).toBe(draft.turnId);
      expect(saved.userInput).toBe('');
      expect(saved.useVariableStage).toBe(false);
      expect(saved.stageStatus).toEqual({ story: 'ready', variables: 'skipped', world: 'pending' });
      expect(visible.some((text) => text.length > 0 && text.length < narrative.length)).toBe(true);
      expect(visible.every((text) => narrative.startsWith(text))).toBe(true);
      expect(await repo.loadDraft(draft.saveId)).toEqual(saved);
      expect(await repo.load(draft.saveId)).toEqual(before);
      const [snapshot] = requestInspections.getSnapshot();
      expect(snapshot.scope?.mode).toBe('opening');
      expect(snapshot.scope?.modules.some((module) => module.id === 'stages.opening.story')).toBe(
        true,
      );
      expect(snapshot.scope?.modules.some((module) => module.id === 'stages.regular.story')).toBe(
        false,
      );
      expect(JSON.stringify(snapshot)).not.toContain('mock-story-secret');
      expect(snapshot.statistics.estimatedTokens).toBeGreaterThan(0);
      expect(
        snapshot.statistics.actual[protocol === 'anthropic' ? 'outputTokens' : 'inputTokens'],
      ).toBe(protocol === 'anthropic' ? 7 : 42);
      expect(client).toHaveBeenCalledTimes(1);
    },
  );
  it('既有合法 regular 草稿使用普通模板与绑定输入，不伪造已结算记录', async () => {
    await repo.deleteDraft(draft.saveId, 0);
    draft = createTurnDraft(draft.saveId, 0, 'existing-regular', 'regular', '等待公交车');
    await repo.saveDraft(draft, null);
    const saved = await runner(async () => sse(output())).generate({ ...setup(), draft });
    expect(saved.story?.turnKind).toBe('regular');
    const snapshot = requestInspections.getSnapshot()[0];
    expect(snapshot.scope?.modules.some((m) => m.id === 'stages.regular.story')).toBe(true);
    expect(JSON.stringify(snapshot.body)).toContain('等待公交车');
    expect((await repo.load(draft.saveId)).journal).toEqual([]);
  });
  it('重新 Roll 成功后递增版本，清除两种旧候选；同一回合、输入与执行开关保持不变', async () => {
    await repo.deleteDraft(draft.saveId, 0);
    draft = createTurnDraft(draft.saveId, 0, 'both-stages', 'opening', '本回合绑定输入');
    await repo.saveDraft(draft, null);
    let old = rerollStory(draft, {
      turnKind: 'opening',
      narrative: '原有效正文',
      summary: '',
      variableGuide: [],
    });
    await repo.saveDraft(old, 0);
    old = TurnDraftSchema.parse({
      ...old,
      draftRevision: 2,
      variables: {
        storyRevision: 1,
        candidateRevision: 1,
        requestRevision: 0,
        validation: 'validated',
        result: { commands: [], rejectedSuggestions: [], unresolved: [] },
      },
      stageStatus: { ...old.stageStatus, variables: 'ready' },
    });
    await repo.saveDraft(old, 1);
    old = TurnDraftSchema.parse({
      ...old,
      draftRevision: 3,
      world: {
        storyRevision: 1,
        candidateRevision: 1,
        requestRevision: 0,
        validation: 'validated',
        basedOnVariableRevision: 1,
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
      stageStatus: { ...old.stageStatus, world: 'ready' },
    });
    await repo.saveDraft(old, 2);
    await expect(
      runner(async () => sse(output('短'))).generate({ ...setup(), draft: old }),
    ).rejects.toBeDefined();
    expect(await repo.loadDraft(draft.saveId)).toEqual(old);
    const saved = await runner(async () => sse(output())).generate({ ...setup(), draft: old });
    expect(saved.storyRevision).toBe(2);
    expect(saved.draftRevision).toBe(4);
    expect(saved.world).toBeUndefined();
    expect(saved.variables).toBeUndefined();
    expect(saved.turnId).toBe(old.turnId);
    expect(saved.userInput).toBe(old.userInput);
    expect(saved.executionRevision).toBe(old.executionRevision);
  });
  it.each([
    '短正文',
    '<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>缺失尾部</正文>',
    output(''),
    output(narrative).replace('变量规划>', '错误标签>'),
  ])('非法输出失败保留原正文：%s', async (bad) => {
    const old = rerollStory(draft, {
      turnKind: 'opening',
      narrative,
      summary: '',
      variableGuide: [],
    });
    await repo.saveDraft(old, 0);
    const text = bad === '短正文' ? output('短') : bad;
    await expect(
      runner(async () => sse(text)).generate({ ...setup(), draft: old }),
    ).rejects.toBeDefined();
    expect(await repo.loadDraft(draft.saveId)).toEqual(old);
  });
  it('最低字数只统计正文；再长的摘要/指导/选项也无法补足', async () => {
    const settings = setup();
    settings.settings.prompts.minNarrativeChars = 100;
    const body = output('短').replace('等车', '摘要'.repeat(1000));
    await expect(
      runner(async () => sse(body)).generate({ ...settings, draft }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
  });
  it('关闭行动选项不接受额外选项块；合法正文不持久化任何选项', async () => {
    const settings = setup();
    settings.settings.prompts.actionOptions = false;
    await expect(
      runner(async () => sse(output())).generate({ ...settings, draft }),
    ).rejects.toBeDefined();
    const saved = await runner(async () => sse(output(narrative, false))).generate({
      ...settings,
      draft,
    });
    expect(saved.story?.actionOptions).toBeUndefined();
  });
  it.each([401, 403, 429, 500])(
    'HTTP %s 安全提示不回显供应商原始秘密，草稿不变',
    async (status) => {
      let message = '';
      try {
        await runner(
          async () => new Response('mock-story-secret 内部错误正文', { status }),
        ).generate({ ...setup(), draft });
      } catch (error) {
        message = storyError(error);
      }
      expect(message).not.toContain('mock-story-secret');
      expect(message).not.toContain('内部错误正文');
      expect(message.length).toBeGreaterThan(5);
      expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
    },
  );
  it('网络失败和空返回不会保存半截草稿', async () => {
    for (const transport of [
      async () => {
        throw new Error('mock-story-secret');
      },
      async () => sse(''),
    ]) {
      await expect(runner(transport).generate({ ...setup(), draft })).rejects.toBeDefined();
      expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
    }
  });
  it('服务异常回显凭证会从流式阅读脱敏且最终拒绝入库', async () => {
    const visible: string[] = [];
    await expect(
      runner(async () => sse(output(narrative + 'mock-story-secret'))).generate({
        ...setup(),
        draft,
        onProgress: (p) => visible.push(p.narrative),
      }),
    ).rejects.toMatchObject({ code: 'invalid_output' });
    expect(visible.join('|')).not.toContain('mock-story-secret');
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
  });
  it('跨控制器重复点击同一存档不发送第二个请求', async () => {
    const started = deferred<void>();
    const transport = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return new Promise<Response>(() => {});
    });
    const first = runner(transport);
    const pending = first.generate({ ...setup(), draft });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await started.promise;
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toMatchObject({
      code: 'STORY_BUSY',
    });
    first.cancel();
    await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('取消后立即重新生成；忽略取消的旧 HTTP 响应迟到不能覆盖新正文', async () => {
    const late = deferred<Response>(),
      started = deferred<void>();
    const first = runner(async () => {
      started.resolve();
      return late.promise;
    });
    const pending = first.generate({ ...setup(), draft });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await started.promise;
    first.cancel();
    const saved = await runner(async () => sse(output())).generate({ ...setup(), draft });
    late.resolve(sse(output('迟到的旧正文，绝不允许取代新正文。')));
    await rejected;
    await new Promise((done) => setTimeout(done, 5));
    expect(await repo.loadDraft(draft.saveId)).toEqual(saved);
  });
  it('超时保留旧草稿且不自动重试', async () => {
    const started = deferred<void>();
    const transport = vi.fn<typeof fetch>(async () => {
      started.resolve();
      return new Promise<Response>(() => {});
    });
    const settings = setup();
    const old = rerollStory(draft, {
      turnKind: 'opening',
      narrative,
      summary: '',
      variableGuide: [],
    });
    await repo.saveDraft(old, 0);
    const request = runner(transport).generate({ ...settings, draft: old });
    await started.promise;
    // 本测试使用实际 1s 定时器，不改变 IDB 事务调度。
    runners[runners.length - 1].dispose();
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    settings.settings.runtime.timeoutSeconds = 1;
    await expect(runner(transport).generate({ ...settings, draft: old })).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(await repo.loadDraft(draft.saveId)).toEqual(old);
  });
  it('切档 dispose 后迟到请求不能写任何存档，另一个存档可独立生成', async () => {
    const before = await repo.load(draft.saveId);
    await repo.create(game('save-b'));
    const other = createTurnDraft('save-b', 0, 'turn-b', 'opening', '另一个输入');
    await repo.saveDraft(other, null);
    const started = deferred<void>(),
      late = deferred<Response>();
    const stage = runner(async () => {
      started.resolve();
      return late.promise;
    });
    const pending = stage.generate({ ...setup(), draft });
    const failed = expect(pending).rejects.toBeDefined();
    await started.promise;
    stage.dispose();
    const saved = await runner(async () => sse(output())).generate({ ...setup(), draft: other });
    late.resolve(sse(output()));
    await failed;
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
    expect(await repo.loadDraft('save-b')).toEqual(saved);
    expect(await repo.load(draft.saveId)).toEqual(before);
  });
  it('请求期间草稿被其他标签页改写，乐观锁拒绝响应覆盖', async () => {
    const started = deferred<void>(),
      response = deferred<Response>();
    const request = runner(async () => {
      started.resolve();
      return response.promise;
    }).generate({ ...setup(), draft });
    await started.promise;
    const elsewhere = rerollStory(draft, {
      turnKind: 'opening',
      narrative: '另一窗口的合法正文',
      summary: '',
      variableGuide: [],
    });
    await repo.saveDraft(elsewhere, 0);
    response.resolve(sse(output()));
    await expect(request).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    expect(await repo.loadDraft(draft.saveId)).toEqual(elsewhere);
  });
  it('正式版本变化或草稿已失效时阻止保存；旧草稿起请求前被拒绝', async () => {
    const transport = vi.fn<typeof fetch>(async () => sse(output()));
    await repo.save(draft.saveId, 0, 'other-turn', [
      {
        type: 'SetWorldClock',
        commandId: 'clock',
        evidence: '等候结束',
        worldClock: '2026-10-18T09:00:00+08:00',
      },
    ]);
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toMatchObject({
      code: 'DRAFT_CONFLICT',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it('保存失败、事务取消均整体保留旧草稿', async () => {
    const fail = vi
      .spyOn(repo, 'saveDraft')
      .mockRejectedValueOnce(new Error('磁盘 mock-story-secret'));
    await expect(
      runner(async () => sse(output())).generate({ ...setup(), draft }),
    ).rejects.toBeDefined();
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
    fail.mockRestore();
    const abort = new AbortController();
    abort.abort();
    await expect(
      repo.saveDraft(
        rerollStory(draft, { turnKind: 'opening', narrative, summary: '', variableGuide: [] }),
        0,
        abort.signal,
      ),
    ).rejects.toBeDefined();
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
  });
  it('完整响应到达后、进入草稿事务前离开页面，整份替换仍可取消回滚', async () => {
    const stage = runner(async () => sse(output()));
    await expect(
      stage.generate({
        ...setup(),
        draft,
        onProgress: (progress) => {
          if (progress.phase === 'saving') stage.dispose();
        },
      }),
    ).rejects.toBeDefined();
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
  });
  it('草稿 put 已排入事务时取消，仍整体回滚，不把 request 成功当作事务成功', async () => {
    const abort = new AbortController();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = original.call(this, value, key);
      if (this.name === 'drafts') abort.abort();
      return request;
    });
    await expect(
      repo.saveDraft(
        rerollStory(draft, {
          turnKind: 'opening',
          narrative,
          summary: '',
          variableGuide: [],
        }),
        0,
        abort.signal,
      ),
    ).rejects.toBeDefined();
    spy.mockRestore();
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
  });
  it('模型请求期间正式状态变更，事务重新读取 revision 后拒绝草稿写入', async () => {
    const started = deferred<void>(),
      response = deferred<Response>();
    const pending = runner(async () => {
      started.resolve();
      return response.promise;
    }).generate({ ...setup(), draft });
    await started.promise;
    const updated = await repo.save(draft.saveId, 0, 'other-change', [
      {
        type: 'SetWorldClock',
        commandId: 'world-clock',
        evidence: '已经过一小时',
        worldClock: '2026-10-18T09:00:00+08:00',
      },
    ]);
    response.resolve(sse(output()));
    await expect(pending).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await repo.loadDraft(draft.saveId)).toEqual(draft);
    expect(await repo.load(draft.saveId)).toEqual(updated);
  });
  it('生成中编辑 UI 设置不会改变草稿的独立开关、绑定输入或本次七项校验', async () => {
    const settings = setup(),
      started = deferred<void>(),
      response = deferred<Response>();
    const pending = runner(async () => {
      started.resolve();
      return response.promise;
    }).generate({ ...settings, draft });
    await started.promise;
    settings.settings.prompts.minNarrativeChars = 100000;
    settings.settings.runtime.useVariableStage = true;
    settings.settings.runtime.useWorldStage = false;
    draft.userInput = '界面新输入不属于本次请求';
    response.resolve(sse(output()));
    const saved = await pending;
    expect(saved.userInput).toBe('');
    expect(saved.useVariableStage).toBe(false);
    expect(saved.useWorldStage).toBe(true);
  });
});
