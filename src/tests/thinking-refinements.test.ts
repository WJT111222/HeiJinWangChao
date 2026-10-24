import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { AiClient } from '../services/ai/client';
import { newChannel, defaultAiConfig, readAiConfig, saveAiConfig, AiConfigSchema } from '../services/ai/configuration';
import type { Protocol, AiTask } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { channelSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { requestInspections, payloadMessages } from '../services/ai/inspection';
import { contextStatistics } from '../prompts/statistics';
import { clearThinkingCapabilities } from '../services/ai/thinking';

function store() { const data = new Map<string, string>(); return {
  getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
}; }
function setup(protocol: Protocol = 'openai', model = 'unknown-model', maxOutputTokens = 8192) {
  const channel = { ...newChannel(protocol), defaultModel: model };
  channel.parameters = { maxOutputTokens, temperature: 0.7 };
  const storage = store(), vault = new CredentialVault(storage, storage); vault.set(channel.id, 'refine-mock-secret');
  return { channel, vault, storage, snapshot: (stage: AiTask = 'story') => channelSnapshot(channel, vault, model, stage) };
}
const messages = [{ role: 'system' as const, content: '世界书及系统资料' }, { role: 'user' as const, content: '玩家输入' }];
function normal(protocol: Protocol) { return Response.json(protocol === 'openai' ? { choices: [{ message: { content: '文本' }, finish_reason: 'stop' }] }
  : protocol === 'gemini' ? { candidates: [{ content: { parts: [{ text: '文本' }] }, finishReason: 'STOP' }] }
    : { content: [{ type: 'text', text: '文本' }], stop_reason: 'end_turn' }); }
afterEach(() => { clearThinkingCapabilities(); requestInspections.clear(); vi.restoreAllMocks(); });

describe('原输出上限字段与玩家预算', () => {
  it('新渠道8K，旧档4K/8K/16K和自定义原样读写，无自动迁移', () => {
    expect(newChannel().parameters.maxOutputTokens).toBe(8192);
    const config = defaultAiConfig(), storage = store();
    config.channels = [4096, 8192, 16384, 32768, 1, 1000000].map((value) => ({ ...newChannel(), parameters: { maxOutputTokens: value } }));
    saveAiConfig(storage, config);
    expect(readAiConfig(storage).channels.map((channel) => channel.parameters.maxOutputTokens)).toEqual([4096, 8192, 16384, 32768, 1, 1000000]);
    const legacy = { ...newChannel(), parameters: {} }; config.channels = [legacy]; saveAiConfig(storage, config);
    expect(readAiConfig(storage).channels[0].parameters.maxOutputTokens).toBeUndefined();
    for (const value of [0, -1, 1.1, 1000001, NaN]) expect(AiConfigSchema.safeParse({ ...config, channels: [{ ...legacy, parameters: { maxOutputTokens: value } }] }).success).toBe(false);
  });
  it('预算需求预测代码和UI已移除，不删除通用输入估算器', () => {
    for (const path of ['src/services/ai/storyInspection.ts', 'src/ui/game/StoryInspectionPanel.tsx', 'src/workflows/storyStage.ts'])
      expect(readFileSync(path, 'utf8')).not.toMatch(/storyBudget|粗估需求|当前输出上限可能不足|item\.budget/);
    expect(contextStatistics(messages).estimatedTokens).toBeGreaterThan(0);
  });
});

describe('原生Thinking官方契约，不按域名排斥原生中转', () => {
  it.each([
    ['gemini-2.5-pro', { includeThoughts: true }], ['gemini-2.5-flash', { includeThoughts: true }],
    ['gemini-2.5-flash-lite', { includeThoughts: true, thinkingBudget: -1 }],
    ['gemini-3-flash-preview', { includeThoughts: true }], ['gemini-3.1-pro-preview', { includeThoughts: true }],
  ])('%s使用合法摘要配置而非一律设置预算', async (model, expected) => {
    const a = setup('gemini', String(model)); a.channel.baseUrl = 'https://relay.mock.invalid/v1beta';
    const transport = vi.fn<typeof fetch>().mockResolvedValue(normal('gemini'));
    const result = await new AiClient(transport).generate(a.snapshot(), messages);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.generationConfig.thinkingConfig).toEqual(expected); expect(body.generationConfig.maxOutputTokens).toBe(8192);
    expect(result.text).toBe('文本'); expect(result.nativeReasoning).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-5-5'])('%s使用adaptive并请求公开摘要、不发送不兼容temperature', async (model) => {
    const a = setup('anthropic', model), transport = vi.fn<typeof fetch>().mockResolvedValue(normal('anthropic'));
    a.channel.baseUrl = 'https://native-relay.mock.invalid/v1';
    await new AiClient(transport).generate(a.snapshot(), messages);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' }); expect(body.temperature).toBeUndefined(); expect(body.max_tokens).toBe(8192);
  });
  it.each(['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-3-7-sonnet-20250219'])('%s手动thinking最小预算合法且不提高玩家上限', (model) => {
    const a = setup('anthropic', model, 4096), body = JSON.parse(wireRequest(a.snapshot(), messages, false).init.body);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 }); expect(body.max_tokens).toBe(4096); expect(body.temperature).toBeUndefined();
    a.channel.parameters.maxOutputTokens = 1024;
    const small = JSON.parse(wireRequest(a.snapshot(), messages, false).init.body);
    expect(small.thinking).toBeUndefined(); expect(small.max_tokens).toBe(1024); expect(small.temperature).toBe(0.7);
  });
  it.each(['claude-sonnet-4-6', 'gemini-2.5-pro', 'deepseek-reasoner', 'glm-thinking'])('未知OpenAI中转即使名称为%s也不盲发非标准启用参数', async (model) => {
    const a = setup('openai', model), transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '文本', reasoning_text: '公开摘要' }, finish_reason: 'stop' }] }));
    a.channel.baseUrl = 'https://unknown-relay.mock.invalid/v1';
    const result = await new AiClient(transport).generate(a.snapshot(), messages), body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    for (const field of ['thinking', 'thinkingConfig', 'reasoning_effort', 'enable_thinking', 'disable_thinking']) expect(body[field]).toBeUndefined();
    expect(result.nativeReasoning).toBe('公开摘要'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['gemini', 'anthropic'] as const)('%s旧/未知型号继续基础请求，不升级为思考型号', async (protocol) => {
    const a = setup(protocol, protocol === 'gemini' ? 'gemini-2.0-flash' : 'claude-3-5-sonnet-20241022');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(normal(protocol)); await new AiClient(transport).generate(a.snapshot(), messages);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.thinking).toBeUndefined(); expect(body.generationConfig?.thinkingConfig).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(['gemini', 'anthropic'] as const)('%s中转Models返回官方能力字段，未知别名可自动启用且快照冻结', async (protocol) => {
    const a = setup(protocol, 'relay-alias'), before = a.snapshot();
    const metadata = protocol === 'gemini' ? { models: [{ name: 'models/relay-alias', thinking: true }] }
      : { data: [{ id: 'relay-alias', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } } }] };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(normal(protocol));
    const client = new AiClient(transport); expect(await client.listModels(before)).toEqual(['relay-alias']);
    expect(before.thinkingCapability).toBe('none');
    const snap = a.snapshot(); expect(snap.thinkingCapability).toBe(protocol === 'gemini' ? 'gemini-summary' : 'anthropic-adaptive');
    await client.generate(snap, messages); expect(transport).toHaveBeenCalledTimes(2); // 一次既有Models查询，一次生成。
    const body = JSON.parse(String(transport.mock.calls[1][1]?.body));
    expect(body.thinking ?? body.generationConfig.thinkingConfig).toEqual(protocol === 'gemini' ? { includeThoughts: true } : { type: 'adaptive', display: 'summarized' });
    expect(a.channel.parameters.maxOutputTokens).toBe(8192);
  });
  it('Gemini中转明确声明基础型号时，为默认关闭的Lite别名启用动态thinking', async () => {
    const a = setup('gemini', 'relay-lite');
    await new AiClient(async () => Response.json({ models: [{ name: 'models/relay-lite', baseModelId: 'gemini-2.5-flash-lite', thinking: true }] })).listModels(a.snapshot());
    expect(a.snapshot().thinkingCapability).toBe('gemini-dynamic');
    expect(JSON.parse(wireRequest(a.snapshot(), messages, false).init.body).generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: -1 });
  });
  it('中转明确不支持的声明覆盖官方型号契约，并与其他渠道隔离', async () => {
    const a = setup('gemini', 'gemini-2.5-pro'), b = setup('gemini', 'gemini-2.5-pro');
    await new AiClient(async () => Response.json({ models: [{ name: 'models/gemini-2.5-pro', thinking: false }] })).listModels(a.snapshot());
    expect(a.snapshot().thinkingCapability).toBe('none'); expect(b.snapshot().thinkingCapability).toBe('gemini-summary');
  });
  it('服务明确拒绝thinking参数时不重发，仅下次手动请求使用兼容路径', async () => {
    const a = setup('anthropic', 'claude-sonnet-4-6');
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: { type: 'invalid_request_error', param: 'thinking', message: 'not supported refine-mock-secret' } }, { status: 400 }))
      .mockResolvedValueOnce(normal('anthropic'));
    const client = new AiClient(transport);
    await expect(client.generate(a.snapshot(), messages)).rejects.toMatchObject({ code: 'rejected' }); expect(transport).toHaveBeenCalledTimes(1);
    expect(a.snapshot().thinkingCapability).toBe('none'); await client.generate(a.snapshot(), messages); expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).thinking).toBeUndefined(); expect(JSON.stringify(requestInspections.getSnapshot())).not.toContain('refine-mock-secret');
  });
  it('取消的Models查询迟到不写入后续请求的能力缓存', async () => {
    const a = setup('anthropic', 'relay-alias'), controller = new AbortController();
    let release!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = new AiClient(transport).listModels(a.snapshot(), { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' }); controller.abort(); await rejected;
    release(Response.json({ data: [{ id: 'relay-alias', capabilities: { thinking: { supported: true, types: { adaptive: { supported: true } } } } }] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.snapshot().thinkingCapability).toBe('none'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('取消请求的参数错误迟到不会禁用新请求的原生能力', async () => {
    const a = setup('anthropic', 'claude-sonnet-4-6'), controller = new AbortController();
    let release!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>((resolve) => { release = resolve; }));
    const pending = new AiClient(transport).generate(a.snapshot(), messages, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' }); controller.abort(); await rejected;
    release(Response.json({ error: { param: 'thinking', message: 'unsupported' } }, { status: 400 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.snapshot().thinkingCapability).toBe('anthropic-adaptive'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('普通400不会被误认为thinking参数拒绝', async () => {
    const a = setup('anthropic', 'claude-sonnet-4-6');
    await expect(new AiClient(async () => Response.json({ error: { param: 'messages', message: 'invalid messages' } }, { status: 400 })).generate(a.snapshot(), messages)).rejects.toMatchObject({ code: 'rejected' });
    expect(a.snapshot().thinkingCapability).toBe('anthropic-adaptive');
  });
});

describe('完整真实输入估算和每请求实际用量', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s按最终wire内容统计，包含补上的user尾消息，发送前已可观察', async (protocol) => {
    const a = setup(protocol), input = [...messages, { role: 'assistant' as const, content: '格式确认' }];
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)), actual = payloadMessages(body, protocol), inspected = requestInspections.getSnapshot()[0];
      expect(actual.at(-1)?.role).toBe('user'); expect(actual.at(-1)?.content).toContain('已确认');
      expect(inspected.status).toBe('pending'); expect(inspected.messages).toEqual(actual);
      expect(inspected.statistics).toEqual(contextStatistics(actual));
      expect(inspected.statistics.estimatedTokens).toBeGreaterThan(contextStatistics(input).estimatedTokens);
      expect(inspected.outputTokenLimit).toBe(8192); expect(inspected.statistics.actual.inputTokens).toBeUndefined();
      return normal(protocol);
    });
    await new AiClient(transport).generate(a.snapshot(), input); expect(transport).toHaveBeenCalledTimes(1);
    expect(requestInspections.getSnapshot()[0].statistics.actual.totalTokens).toBeUndefined();
  });
  it.each([false, true])('Anthropic含缓存的完整输入及公开usage思考计数（stream=%s），不伪造total', async (streaming) => {
    const a = setup('anthropic'), usage = { input_tokens: 50, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20000,
      output_tokens: 500, output_tokens_details: { thinking_tokens: 300 } };
    const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    const text = frame({ type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } })
      + frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: '文本' } })
      + frame({ type: 'message_delta', usage: { output_tokens: 500, output_tokens_details: { thinking_tokens: 300 } } }) + frame({ type: 'message_stop' });
    const client = new AiClient(async () => streaming ? new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json({ content: [{ type: 'text', text: '文本' }], stop_reason: 'end_turn', usage }));
    const result = await client.generate(a.snapshot(), messages, { stream: streaming });
    expect(result.usage).toEqual({ inputTokens: 21050, outputTokens: 500, reasoningTokens: 300 });
    expect(requestInspections.getSnapshot()[0].statistics.actual.totalTokens).toBeUndefined();
  });
  it('无完整或合法输入用量时不凭缓存或字符数编造真实输入', async () => {
    const a = setup('anthropic');
    for (const usage of [{ cache_read_input_tokens: 20000 }, { input_tokens: 50, cache_creation_input_tokens: -1 }]) {
      const result = await new AiClient(async () => Response.json({ content: [{ type: 'text', text: '文本' }], stop_reason: 'end_turn', usage }))
        .generate(a.snapshot(), messages);
      expect(result.usage?.inputTokens).toBeUndefined();
    }
  });
  it('完整系统/世界书/规划/人物/记忆/输入均包含，高输入规模不触发预算判断', async () => {
    const a = setup(), input = [{ role: 'system' as const, content: '系统世界书阶段及规划链'.repeat(10000) },
      { role: 'user' as const, content: JSON.stringify({ protagonist: '人物', npc: '现场资料', memories: '历史记忆'.repeat(5000), worldClock: '游戏时间', playerInput: '玩家行动' }) },
      { role: 'assistant' as const, content: '格式确认' }];
    const transport = vi.fn<typeof fetch>().mockResolvedValue(normal('openai')); await new AiClient(transport).generate(a.snapshot(), input);
    const request = requestInspections.getSnapshot()[0]; expect(request.statistics.characters).toBeGreaterThan(100000);
    expect(request.statistics.estimatedTokens).toBeGreaterThan(8192); expect(request.outputTokenLimit).toBe(8192); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('正文/变量/世界/记忆各自路由、输入、usage独立，不合并为假想账单', async () => {
    const a = setup(); let index = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { index++; return Response.json({ choices: [{ message: { content: '返回' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: index * 100, completion_tokens: index * 10, total_tokens: index * 110, completion_tokens_details: { reasoning_tokens: index } } }); });
    for (const stage of ['story', 'variables', 'world', 'memory'] as const) {
      const snap = channelSnapshot(a.channel, a.vault, stage + '-model', stage);
      await new AiClient(transport).generate(snap, [{ role: 'user', content: stage.repeat(index + 1) }], { inspection: { kind: stage === 'memory' ? 'memory' : 'stage', mode: 'regular', saveId: 'stats-save', revision: 0, modules: [] } });
    }
    const requests = requestInspections.getSnapshot(); expect(requests).toHaveLength(4);
    expect(requests.map((item) => item.route.model)).toEqual(['memory-model', 'world-model', 'variables-model', 'story-model']);
    expect(requests.map((item) => item.statistics.actual)).toEqual([4, 3, 2, 1].map((value) => ({ inputTokens: value * 100, outputTokens: value * 10, totalTokens: value * 110, reasoningTokens: value })));
    expect(new Set(requests.map((item) => item.id)).size).toBe(4); expect(transport).toHaveBeenCalledTimes(4);
  });
});
