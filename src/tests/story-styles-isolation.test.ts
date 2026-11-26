import { sceneWorldSettings as defaultSettings, sceneWorldDraft as createTurnDraft } from './fixtures/stageScope';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { composePrompt } from '../prompts/composer';
import { readPromptResource } from '../prompts/loader';
import { formatTailMessage } from '../prompts/formatTail';
import { continuationInstruction } from '../domain/storyContinuation';
import type { TurnDraft } from '../domain/drafts';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { AiStage } from '../services/ai/configuration';
import { SaveRepository } from '../services/storage/saveRepository';
import { STORY_STYLE_IDS } from '../ui/settings/storyStyles';
import type { StoryStyle } from '../ui/settings/storyStyles';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { stageContext } from './fixtures/eventStages';
import { variableReply } from './fixtures/variableReply';
import { worldState, worldDraft, worldResult, npcUpdate, worldNarrative } from './fixtures/world';

/**
 * 剧情风格只作用于 Story 的 <正文>：
 * - Variables / World / Memory 的完整组包（messages、modules、context）在只切换风格时与 general 完全相同；
 * - Story 只有被选风格模块与 PROMPT_SETTINGS 里的风格名变化；格式骨架、字数要求、续写指令不变；
 * - 离线 Mock：同一份模型回复在七种风格下解析出的摘要、变量规划与领域结果完全相同。
 * 这些只证明请求、解析与领域层的隔离，不证明真实模型在不同风格下写出的摘要逐字相同。
 */
const withStyle = (style: StoryStyle) => { const settings = defaultSettings(); settings.prompts.style = style; return settings; };
const regular = () => {
  const a = stageContext();
  a.draft.turnKind = 'regular';
  a.draft.story!.turnKind = 'regular';
  return a;
};
const contextOf = (messages: { role: string; content: string }[]) => messages.find((m) => m.content.includes('<GAME_CONTEXT>'))!.content;

describe('非 Story 阶段：仅切换剧情风格时完整组包与 general 相同', () => {
  const a = regular();
  it.each(['variables', 'world'] as const)('%s：七种风格的 messages / modules / context / <GAME_CONTEXT> 全部相同，出站风格为 general', async (stage) => {
    const base = await composePrompt({ stage, mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings: withStyle('general') });
    expect(contextOf(base.messages)).toContain('"style":"general"');
    for (const style of STORY_STYLE_IDS) {
      const current = await composePrompt({ stage, mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings: withStyle(style) });
      expect(current.messages, style).toEqual(base.messages);
      expect(current.modules, style).toEqual(base.modules);
      expect(current.context, style).toEqual(base.context);
      expect(contextOf(current.messages), style).toBe(contextOf(base.messages));
      expect(current.modules.some((m) => m.id.startsWith('writing.style_')), style).toBe(false);
      if (style !== 'general') expect(JSON.stringify(current.messages), style).not.toContain(`"style":"${style}"`);
    }
  });
  it.each(['memory.short_to_medium', 'memory.npc_summarize'] as const)('Memory %s：七种风格的完整组包全部相同', async (memoryTask) => {
    const npc = memoryTask === 'memory.npc_summarize' ? { npcId: Object.keys(a.state.npc)[0]!, npcSummaryThreshold: defaultSettings().memory.summaries.npc.threshold } : {};
    const compose = (style: StoryStyle) => composePrompt({ stage: 'memory', memoryTask, ...npc, state: a.state, mode: 'regular', userInput: '', settings: withStyle(style) });
    const base = await compose('general');
    for (const style of STORY_STYLE_IDS) {
      const current = await compose(style);
      expect(current.messages, style).toEqual(base.messages);
      expect(current.modules, style).toEqual(base.modules);
      expect(current.context, style).toEqual(base.context);
    }
  });
  it('出站投影不改玩家保存的设置对象', async () => {
    const settings = withStyle('absurd');
    await composePrompt({ stage: 'world', mode: 'regular', state: a.state, draft: a.draft, userInput: '继续', settings });
    expect(settings.prompts.style).toBe('absurd');
  });
});

describe('Story 阶段：只换风格模块，格式与字数协议不变', () => {
  const bodies = new Map<string, string>();
  const text = (id: string) => bodies.get(id)!;
  beforeAll(async () => { for (const id of STORY_STYLE_IDS) bodies.set(id, (await readPromptResource(`writing.style_${id}`)).trim()); });
  const normalize = (messages: { content: string }[]) => messages.map((m) => STORY_STYLE_IDS
    .reduce((c, id) => c.replace(text(id), '<STYLE>'), m.content).replace(/\\?"style\\?":\\?"[a-z]+\\?"/gu, '"style":"<ID>"'));
  it.each(['opening', 'regular'] as const)('%s 回合：七种风格互斥启用；除风格模块与风格名外请求完全相同', async (mode) => {
    const state = worldState(), draft = createTurnDraft(state.saveId, state.revision, 'turn-style', mode, mode === 'opening' ? '' : '去码头');
    const compose = (style: StoryStyle) => composePrompt({ stage: 'story', mode, state, draft, userInput: draft.userInput, settings: withStyle(style) });
    const base = await compose('general');
    for (const style of STORY_STYLE_IDS) {
      const current = await compose(style);
      expect(current.modules.filter((m) => m.id.startsWith('writing.style_')).map((m) => m.id), style).toEqual([`writing.style_${style}`]);
      expect(current.messages.some((m) => m.content.includes(text(style))), style).toBe(true);
      expect(normalize(current.messages), style).toEqual(normalize(base.messages));
      expect(current.messages.at(-1), style).toEqual(base.messages.at(-1));
      expect(current.context, style).toEqual(base.context);
    }
  });
  it('格式骨架、字数要求与续写指令都不接收风格参数', () => {
    const settings = withStyle('shuang');
    const tail = formatTailMessage('story', settings.prompts)!;
    expect(tail).toBe(formatTailMessage('story', withStyle('general').prompts));
    for (const tag of ['<正文>', '<短期记忆>', '<变量规划>']) expect(tail).toContain(tag);
    const ask = (s: typeof settings) => continuationInstruction({ actionOptions: s.prompts.actionOptions, minNarrativeChars: s.prompts.minNarrativeChars, maxNarrativeChars: s.prompts.maxNarrativeChars, partial: '<正文>雨夜' });
    expect(ask(settings)).toBe(ask(withStyle('general')));
  });
  it('六个新风格都声明只作用于 <正文>，短期记忆、变量规划、行动选项保持中性事实规则', () => {
    for (const id of STORY_STYLE_IDS.filter((s) => s !== 'general')) {
      const body = text(id);
      expect(body, id).toContain('作用范围：本风格只作用于 <正文> 的文学表达。<短期记忆> 保持客观、准确、简洁，只记录真实发生的事实');
      expect(body, id).toContain('<变量规划> 只依据已经成立的故事事实提出候选，不因风格改变数值、时间、人物关系或事件结论');
      expect(body, id).toContain('<行动选项>（如启用）保持行动含义与玩家的选择权');
      expect(body, id).toContain('风格不改写已经发生的事实，也不为了风格效果额外安排事件、胜负或后果');
      // 不再把风格写成世界模拟规则。
      expect(body, id).not.toMatch(/都要付出看得见的代价|冲突靠筹码、人情与时机解决|集中兑现高光时刻：打脸、反转|计划总在最不合适的时候出岔子|轻描淡写或被化解/u);
    }
  });
});

describe('离线 Mock：同一份模型回复在七种风格下得到相同的摘要、变量规划与领域结果', () => {
  const story = `<thinking>本轮创作提纲：保持人物与场景连续，按行动呈现事实。</thinking><正文>${worldNarrative}</正文><短期记忆>主角在店里用餐并付款三十元。</短期记忆><变量规划>[]</变量规划>`;
  const repos: SaveRepository[] = [], runners: TurnCoordinator[] = [];
  afterEach(() => { runners.splice(0).forEach((r) => r.dispose()); repos.splice(0).forEach((r) => r.close()); });
  async function run(style: StoryStyle) {
    const repo = await SaveRepository.open(`style-isolation-${style}`, new IDBFactory()); repos.push(repo);
    await repo.create(worldState());
    const draft: TurnDraft = await repo.saveDraft(createTurnDraft('save-a', 0, 'turn-a', 'opening', ''), null);
    const config = defaultAiConfig(), channel = newChannel();
    channel.baseUrl = 'https://style-isolation.mock.invalid/v1';
    config.channels = [channel];
    config.routes.story = { channelId: channel.id, modelId: 'story' };
    config.routes.variables = { mode: 'independent', channelId: channel.id, modelId: 'variables' };
    config.routes.world = { mode: 'independent', channelId: channel.id, modelId: 'world' };
    const values = new Map<string, string>();
    const store = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-style-key');
    const settings = withStyle(style); settings.prompts.minNarrativeChars = 5; settings.prompts.actionOptions = false;
    const sent: Partial<Record<AiStage, unknown[]>> = {};
    const coordinator = new TurnCoordinator(repo, new AiClient(async (_url, init) => {
      const body = JSON.parse(String(init?.body)), stage = body.model as AiStage;
      sent[stage] = body.messages;
      return stage === 'story'
        ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: story } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({ choices: [{ message: { content: stage === 'variables' ? variableReply(worldDraft().variables!.result) : JSON.stringify(worldResult([{ ...npcUpdate(), expectedRevision: 0 }])) }, finish_reason: 'stop' }] });
    }));
    runners.push(coordinator);
    expect((await coordinator.generate({ config, vault, settings, draft })).status).toBe('complete');
    const saved = (await repo.loadDraft('save-a'))!;
    return { saved, sent };
  }
  // 各次运行的存档创建时间不同，比较前抹去时间戳。
  const stamp = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu, '<T>'));
  it('摘要、变量规划、变量命令、世界结果，以及 Variables / World 的实际出站请求，七种风格完全相同', async () => {
    const base = await run('general');
    expect(base.saved.story?.summary).toBe('主角在店里用餐并付款三十元。');
    for (const style of STORY_STYLE_IDS.filter((s) => s !== 'general')) {
      const current = await run(style);
      expect(current.saved.story?.narrative, style).toBe(base.saved.story?.narrative);
      expect(current.saved.story?.summary, style).toBe(base.saved.story?.summary);
      expect(current.saved.story?.variableGuide, style).toEqual(base.saved.story?.variableGuide);
      expect(stamp(current.saved.variables?.result), style).toEqual(stamp(base.saved.variables?.result));
      expect(stamp(current.saved.world), style).toEqual(stamp(base.saved.world));
      expect(current.saved.stageStatus, style).toEqual(base.saved.stageStatus);
      expect(stamp(current.sent.variables), style).toEqual(stamp(base.sent.variables));
      expect(stamp(current.sent.world), style).toEqual(stamp(base.sent.world));
      expect(JSON.stringify(current.sent.story), style).toContain(`剧情风格：`);
    }
  });
});
