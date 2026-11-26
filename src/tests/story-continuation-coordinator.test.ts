import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { AiClient } from '../services/ai/client';
import { AiError } from '../services/ai/errors';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { AiStage } from '../services/ai/configuration';
import { storyFailureText } from '../services/ai/runtime';
import { partialNarrative } from '../domain/storyContinuation';
import { DataError } from '../domain/common';
import { SaveRepository } from '../services/storage/saveRepository';
import { createTurnDraft, TurnDraftSchema } from '../domain/drafts';
import type { TurnDraft } from '../domain/drafts';
import { defaultSettings } from '../ui/settings/model';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { StoryStage } from '../workflows/storyStage';
import { variableReply } from './fixtures/variableReply';
import { worldState, worldDraft, worldResult, npcUpdate, worldNarrative } from './fixtures/world';

/** 续写由玩家点按钮触发：同一次运行里的自动重试只能续写，用完次数就停，绝不悄悄改成从头生成。 */
const head = `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${worldNarrative.slice(0, 12)}`;
const tail = `${worldNarrative.slice(12)}</正文><短期记忆>用餐</短期记忆><变量规划>[]</变量规划>`;
type Message = { role: string; content: string };

function setup() {
  const config = defaultAiConfig(), channel = newChannel();
  channel.baseUrl = 'https://continuation-coordinator.mock.invalid/v1';
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: 'story' };
  config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
  config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
  const values = new Map<string, string>();
  const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const vault = new CredentialVault(store, store);
  vault.set(channel.id, 'mock-continuation-key');
  const settings = defaultSettings();
  settings.prompts.minNarrativeChars = 5;
  settings.prompts.actionOptions = false;
  return { config, vault, settings };
}
function reply(stage: AiStage, text: string) {
  return stage === 'story'
    ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    : Response.json({ choices: [{ message: { content: stage === 'variables' ? variableReply(worldDraft().variables!.result) : JSON.stringify(worldResult([{ ...npcUpdate(), expectedRevision: 0 }])) }, finish_reason: 'stop' }] });
}

let repo: SaveRepository, draft: TurnDraft;
const runners: TurnCoordinator[] = [];
function runner(fetcher: typeof fetch) {
  const value = new TurnCoordinator(repo, new AiClient(fetcher));
  runners.push(value);
  return value;
}
async function current() {
  const value = await repo.loadDraft('save-a');
  if (!value) throw new Error('draft missing');
  return value;
}
beforeEach(async () => {
  repo = await SaveRepository.open('continuation-coordinator', new IDBFactory());
  await repo.create(worldState());
  const base = createTurnDraft('save-a', 0, 'turn-a', 'opening', '');
  draft = TurnDraftSchema.parse({ ...base, stageStatus: { ...base.stageStatus, story: 'failed' },
    failures: [{ stage: 'story', attempt: 1, storyRevision: 0, errorCode: 'output_limit', retryable: false }],
    storyPartial: { text: head, storyRevision: 0, continuations: 2 } });
  draft = await repo.saveDraft(draft, null);
});
afterEach(() => {
  runners.splice(0).forEach((r) => r.dispose());
  repo.close();
  vi.restoreAllMocks();
});

describe('续写与自动重试', () => {
  it('已续写 2 次 → 续写遇到 HTTP 500 两次：两次都是续写请求，不扣次数，已写部分保留，没有从头生成', async () => {
    const story: Message[][] = [];
    const coordinator = runner(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.model === 'story') story.push(body.messages);
      return new Response('', { status: 500 });
    });
    await expect(coordinator.generate({ ...setup(), draft })).rejects.toThrow();
    expect(story).toHaveLength(2);
    for (const messages of story) {
      expect(messages.at(-2)).toEqual({ role: 'assistant', content: head });
      expect(String(messages.at(-1)?.content)).toContain('【续写】');
      // 续写指令带上按已写部分与本次设置算出的字数。
      expect(String(messages.at(-1)?.content)).toContain(`目前已写 ${partialNarrative(head).chars} 字，已达到最低 5 字`);
    }
    const saved = await current();
    expect(saved.storyPartial).toEqual({ text: head, storyRevision: 0, continuations: 2 });
    expect(saved.stageStatus.story).toBe('failed');
  });

  it('已续写 2 次 → 续写遇到 HTTP 500 → 自动重试仍是续写，写完后照常结算三阶段', async () => {
    const calls: { stage: AiStage; continuing: boolean }[] = [];
    let failed = false;
    const coordinator = runner(async (_url, init) => {
      const body = JSON.parse(String(init?.body)), stage = body.model as AiStage;
      calls.push({ stage, continuing: String((body.messages as Message[]).at(-1)?.content).includes('【续写】') });
      if (stage === 'story' && !failed) { failed = true; return new Response('', { status: 500 }); }
      return reply(stage, tail);
    });
    expect((await coordinator.generate({ ...setup(), draft })).status).toBe('complete');
    expect(calls.filter((c) => c.stage === 'story')).toEqual([{ stage: 'story', continuing: true }, { stage: 'story', continuing: true }]);
    const saved = await current();
    expect(saved.storyPartial).toBeUndefined();
    expect(saved.story?.narrative).toBe(worldNarrative);
  });

  it('续写返回了内容后遇到可重试错误、次数因此用完：停下并保留已写部分，不再发起任何正文请求', async () => {
    const longer = `${head}${worldNarrative.slice(12, 20)}`;
    const generate = vi.spyOn(StoryStage.prototype, 'generate').mockImplementation(async () => {
      const error = new AiError('server', 500);
      storyFailureText.set(error, { text: longer, produced: true });
      throw error;
    });
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status: 500 }));
    await expect(runner(transport).generate({ ...setup(), draft })).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]![0].continuation).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    const saved = await current();
    // 服务器错误不属于「没写完」：保留原来的已写部分，只记下这次消耗。
    expect(saved.storyPartial).toEqual({ text: head, storyRevision: 0, continuations: 3 });
    expect(saved.stageStatus.story).toBe('failed');
  });
});

/** 兼容渠道把推理写成开头的 <think>…</think>：与正式解析一致先剥掉，推理不进入可续写的正文。 */
describe('前导 <think> 的截断原文', () => {
  const expectedWriting = { source: 'native', min: 5, max: 2000, perspective: setup().settings.prompts.perspective,
    style: setup().settings.prompts.style, naturalProse: setup().settings.prompts.naturalProse };
  function sse(chunks: string[], finish: string) {
    const events = chunks.map((content, index) => ({ choices: [{ delta: { content }, finish_reason: index === chunks.length - 1 ? finish : null }] }));
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }
  async function freshDraft() {
    await repo.deleteDraft('save-a', draft.draftRevision);
    draft = await repo.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'opening', ''), null);
  }
  it('<think> 闭合后写到正文才截断：保存去掉推理的正文，可以续写', async () => {
    await freshDraft();
    const coordinator = runner(async () => sse(['<think>内部推理：先想', '想人物动机。</think>\n', head], 'length'));
    await expect(coordinator.generate({ ...setup(), draft })).rejects.toThrow();
    const saved = await current();
    expect(saved.storyPartial).toEqual({ text: head, storyRevision: 0, continuations: 0, writing: expectedWriting });
    expect(JSON.stringify(saved)).not.toContain('内部推理');
  });
  it('<think> 还没闭合就截断：没有正文可保存', async () => {
    await freshDraft();
    const coordinator = runner(async () => sse(['<think>内部推理：', '还在想'], 'length'));
    await expect(coordinator.generate({ ...setup(), draft })).rejects.toThrow();
    const saved = await current();
    expect(saved.storyPartial).toBeUndefined();
    expect(JSON.stringify(saved)).not.toContain('内部推理');
  });
  it('续写回复也以 <think> 开头又被截断：拼接时去掉推理，并累计续写次数', async () => {
    const more = worldNarrative.slice(12, 20);
    const coordinator = runner(async () => sse(['<think>续写前的推理</think>', more], 'length'));
    await expect(coordinator.generate({ ...setup(), draft })).rejects.toThrow();
    const saved = await current();
    expect(saved.storyPartial).toEqual({ text: `${head}${more}`, storyRevision: 0, continuations: 3, writing: expectedWriting });
    expect(JSON.stringify(saved)).not.toContain('续写前的推理');
  });
});

/** 正文已闭合但字数不足：续写只能在 </正文> 后补标签，补不了字数，所以不发请求。 */
describe('正文已闭合但字数不足', () => {
  const closed = `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${worldNarrative}</正文>`;
  const chars = partialNarrative(closed).chars;
  async function closedDraft() {
    const latest = await current();
    return repo.saveDraft({ ...latest, draftRevision: latest.draftRevision + 1, storyPartial: { text: closed, storyRevision: 0, continuations: 0 } }, latest.draftRevision, undefined, latest);
  }
  it('最低字数高于已写字数：拒绝续写，不发出任何请求，已写部分不变', async () => {
    const saved = await closedDraft();
    const transport = vi.fn<typeof fetch>(async () => new Response('', { status: 500 }));
    const { config, vault, settings } = setup(); settings.prompts.minNarrativeChars = chars + 1;
    const stage = new StoryStage(repo, new AiClient(transport));
    await expect(stage.generate({ draft: saved, settings, config, vault, continuation: true })).rejects.toBeInstanceOf(DataError);
    expect(transport).not.toHaveBeenCalled();
    expect((await current()).storyPartial?.text).toBe(closed);
  });
  it('设置改为不高于已写字数后：可以续写，指令要求只补结构标签，补齐后照常结算', async () => {
    const saved = await closedDraft();
    const story: Message[][] = [];
    const coordinator = runner(async (_url, init) => {
      const body = JSON.parse(String(init?.body)), stage = body.model as AiStage;
      if (stage === 'story') story.push(body.messages);
      return reply(stage, '<短期记忆>用餐</短期记忆><变量规划>[]</变量规划>');
    });
    const { config, vault, settings } = setup(); settings.prompts.minNarrativeChars = chars;
    expect((await coordinator.generate({ config, vault, settings, draft: saved })).status).toBe('complete');
    expect(story).toHaveLength(1);
    expect(String(story[0]!.at(-1)?.content)).toContain(`<正文> 已经完整结束，共 ${chars} 字`);
    expect(String(story[0]!.at(-1)?.content)).toContain('只补齐缺少的结构标签');
  });
});
