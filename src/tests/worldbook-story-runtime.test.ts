import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { tavernWire } from '../presets/tavern/wire';
import { composePrompt } from '../prompts/composer';
import { inspectBudget } from '../prompts/budgetInspection';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestInspections } from '../services/ai/inspection';
import { wireRequest, type AiMessage } from '../services/ai/protocols';
import { loadMainWorldview } from '../services/worldbook/mainWorldview';
import { runStageRequest } from '../services/ai/runtime';
import { requestSnapshot } from '../services/ai/snapshot';
import { stageResponses } from '../services/ai/stageResponses';
import { prepareStoryWorldbook, type StoryWorldbookOutcome } from '../services/worldbook/storyWorldbook';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

vi.mock('../services/worldbook/storyWorldbook', async importOriginal => ({
  ...await importOriginal<typeof import('../services/worldbook/storyWorldbook')>(),
  prepareStoryWorldbook: vi.fn(),
}));
const prepare = vi.mocked(prepareStoryWorldbook);
const story = { turnKind: 'regular' as const, narrative: '本轮完整正文。', summary: '记录本轮结果。', variableGuide: [] };
const reply = '<正文>本轮完整正文。</正文><短期记忆>记录本轮结果。</短期记忆>';
const skipped = { status: 'skipped', reason: 'timeout', message: '世界书扫描超时，本次未使用玩家世界书。' } as const;
const active: StoryWorldbookOutcome = {
  status: 'ok', plan: {
    before: ['第一条 {{user}} </PLAYER_WORLDBOOK>'], after: ['第二条'], authorNoteTop: ['第三条'],
    authorNoteBottom: ['第四条'], exampleMessages: [{ position: 'after', content: '第五条' }],
    atDepth: [{ depth: 1, role: 0, contents: ['第七条'] }, { depth: 4, role: 2, contents: ['第六条'] }],
    outlets: { hidden: ['绝不发出的出口'] },
  },
  activated: [], books: [], budget: { used: 50, hard: 4096, soft: 8000, limit: 4096, overflowed: false },
  incomplete: false, via: 'worker',
};

beforeEach(() => {
  prepare.mockReset();
  prepare.mockResolvedValue({ status: 'off' });
});
afterEach(() => {
  requestInspections.clear();
  stageResponses.clear();
});

function setup() {
  const state = game(), settings = defaultSettings();
  settings.prompts.minNarrativeChars = 1;
  settings.prompts.actionOptions = false;
  state.turnNumber = 2;
  state.revision = 2;
  delete state.openingInitializationPending;
  state.journal = ['更早的公开正文', '最近的公开正文'].map((narrative, index) => ({
    turnId: 'settled-' + index, revision: index + 1, story: { ...story, narrative }, relatedActorRefs: [],
  }));
  const draft = createTurnDraft(state.saveId, state.revision, 'turn-current', 'regular', '玩家本轮行动');
  const input = { state, draft, stage: 'story', mode: 'regular', settings, userInput: draft.userInput } as const;
  const config = defaultAiConfig(), channel = { ...newChannel('openai'), defaultModel: 'mock-model' };
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: channel.defaultModel };
  const storage = new Map<string, string>();
  const port = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); } };
  const vault = new CredentialVault(port, port);
  vault.set(channel.id, 'worldbook-test-only');
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }));
  const client = new AiClient(transport);
  const options = { stream: false, presetSelection: null };
  return { input, config, vault, transport, options, client };
}

it('off 仍逐字发送未开启世界书时的 HTTP 请求', async () => {
  const { input, config, vault, transport, options, client } = setup();
  const snapshot = requestSnapshot(config, 'story', vault);
  const base = await composePrompt({ ...input, cotAllowed: snapshot.useCot }, null);
  await runStageRequest(input, config, vault, options, client);
  expect(prepare).toHaveBeenCalledExactlyOnceWith({
    mainBooks: [], messages: ['玩家本轮行动', '最近的公开正文', '更早的公开正文'],
    contextTokens: 32000, storyRemainingTokens: 4096, messageCount: 5,
    trigger: 'normal', seed: 'save-a:turn-current:1',
  }, expect.objectContaining({ signal: undefined }));
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][1]?.body).toBe(wireRequest(snapshot, base.messages, false).init.body);
});

it('HTTP user 容器位于内置书和其他 system 模块之后，保留宏、预算分类与原消息', async () => {
  const { input, config, vault, transport, options, client } = setup();
  prepare.mockResolvedValue(active);
  const snapshot = requestSnapshot(config, 'story', vault);
  const base = await composePrompt({ ...input, cotAllowed: snapshot.useCot }, null);
  await runStageRequest(input, config, vault, options, client);
  const body = JSON.parse(String(transport.mock.calls[0][1]?.body)) as { messages: AiMessage[] };
  const index = body.messages.findIndex(m => m.content.startsWith('<PLAYER_WORLDBOOK>'));
  expect(index).toBeGreaterThan(0);
  expect(body.messages.slice(index).some(m => m.role === 'system')).toBe(false);
  const message = body.messages[index];
  expect(message.role).toBe('user');
  expect(message.content).toContain('{{user}}');
  expect(message.content.match(/<\/PLAYER_WORLDBOOK>/g)).toHaveLength(1);
  expect(message.content).not.toContain('绝不发出的出口');
  const order = ['第一条', '第二条', '第三条', '第四条', '第五条', '第六条', '第七条'].map(text => message.content.indexOf(text));
  expect(order.every((at, i) => at >= 0 && (!i || at > order[i - 1]))).toBe(true);
  expect(body.messages.filter((_, i) => i !== index)).toEqual(base.messages);
  const inspection = requestInspections.getSnapshot()[0];
  expect(inspection.messages).toEqual(body.messages);
  expect(inspection.statistics.estimatedTokens).toBeGreaterThan(0);
  expect(inspectBudget(inspection.messages).categories.find(c => c.id === 'player_worldbook')).toMatchObject({
    bytes: new TextEncoder().encode(message.content).length,
  });
});

it('预设转换后仍可定位逐条历史时，指定深度的资料放到对应楼层且统一使用 user 角色', () => {
  const { config, vault } = setup();
  const snapshot = requestSnapshot(config, 'story', vault);
  const history: AiMessage[] = [
    { role: 'assistant', content: '已结算的历史楼层' },
    { role: 'user', content: '当前楼层的行动' },
  ];
  const messages = [{ role: 'system', content: '固定世界书' }, ...history, { role: 'user', content: '按格式生成正文' }];
  const raw = { messages, stream: false, n: 1, chat_completion_source: 'custom', custom_prompt_post_processing: '' };
  const plan = { ...active.plan, atDepth: [{ depth: 1, role: 0, contents: ['楼层前 {{char}}'] }] };
  const wire = JSON.parse(tavernWire(snapshot, raw, undefined, { plan, history }).init.body).messages as AiMessage[];
  expect(wire[1]).toMatchObject({ role: 'user', content: expect.stringContaining('第一条') });
  expect(wire[2]).toEqual(history[0]);
  expect(wire[3]).toMatchObject({ role: 'user', content: expect.stringContaining('楼层前 {{char}}') });
  expect(wire.slice(4)).toEqual(messages.slice(2));
  expect(raw.messages).toEqual(messages);
});

it.each(['timeout', 'cancelled', 'library_unavailable', 'throw'] as const)('世界书 %s 记录一次说明并继续 Story', async reason => {
  const { input, config, vault, transport, options, client } = setup();
  if (reason === 'throw') prepare.mockRejectedValue(new Error('内部异常文本不应暴露'));
  else prepare.mockResolvedValue({ ...skipped, reason });
  await expect(runStageRequest(input, config, vault, options, client)).resolves.toMatchObject({ result: story });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][1]?.body).not.toContain('PLAYER_WORLDBOOK');
  expect(stageResponses.getSnapshot()[0].notes).toHaveLength(1);
  expect(stageResponses.getSnapshot()[0].notes?.[0]).toMatch(/世界书/);
  expect(stageResponses.getSnapshot()[0].notes).not.toContain('内部异常文本不应暴露');
});

it('取消 Story 使用同一信号中止世界书，即使扫描迟到也不传输', async () => {
  const { input, config, vault, transport, options, client } = setup();
  const controller = new AbortController();
  prepare.mockImplementation(async (_input, run) => {
    expect(run?.signal).toBe(controller.signal);
    controller.abort();
    return active;
  });
  await expect(runStageRequest(input, config, vault, { ...options, signal: controller.signal }, client))
    .rejects.toMatchObject({ code: 'cancelled' });
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(transport).not.toHaveBeenCalled();
});

it.each(['regenerate', 'continue', 'normal'] as const)('以 %s 扫描重新生成、续写和失败重试', async trigger => {
  const { input, config, vault, transport, options, client } = setup();
  const chosen = rerollStory(input.draft, story);
  const draft = trigger !== 'normal' ? chosen : {
    ...chosen,
    stageStatus: { ...chosen.stageStatus, story: 'failed' as const },
    failures: [{ stage: 'story' as const, attempt: 1, storyRevision: chosen.storyRevision, errorCode: 'timeout', retryable: false }],
  };
  if (trigger === 'continue') transport.mockResolvedValue(Response.json({
    choices: [{ message: { content: '正文继续。</正文><短期记忆>完成续写。</短期记忆>' }, finish_reason: 'stop' }],
  }));
  await runStageRequest({ ...input, draft, worldview:await loadMainWorldview() }, config, vault, {
    ...options, ...(trigger === 'continue' ? { continuation: { partial: '<正文>已有正文。' } } : {}),
  }, client);
  expect(prepare).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    trigger, seed: 'save-a:turn-current:' + (trigger === 'normal' ? '3' : '2'),
  }), expect.anything());
});
