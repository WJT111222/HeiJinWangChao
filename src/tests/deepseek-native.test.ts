import { describe, expect, it, vi } from 'vitest';
import { AiConfigSchema, defaultAiConfig, defaultUrls, isOpenAiCompatible, newChannel, readAiConfig, saveAiConfig } from '../services/ai/configuration';
import { AiClient } from '../services/ai/client';
import { CredentialVault } from '../services/ai/credentials';
import { channelSnapshot, requestSnapshot } from '../services/ai/snapshot';
import { wireRequest } from '../services/ai/protocols';
import { modelListCandidates } from '../services/ai/modelListing';
import { payloadMessages } from '../services/ai/inspection';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
}
function setup() {
  const storage = memory(), vault = new CredentialVault(storage, storage);
  const channel = { ...newChannel('deepseek'), defaultModel: 'deepseek-flash' };
  vault.set(channel.id, 'mock-secret-do-not-send');
  return { vault, channel, snapshot: () => channelSnapshot(channel, vault) };
}
const messages = [{ role: 'system' as const, content: '世界规则' }, { role: 'user' as const, content: '现在开始' }];
const reply = (content: string, reasoning = '') => ({ choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12, completion_tokens_details: { reasoning_tokens: 2 } } });
const frame = (data: unknown) => 'data: ' + JSON.stringify(data) + '\n\n';

describe('原生 DeepSeek 协议（Chat Completions）', () => {
  it('第四协议有独立标识，默认官方根地址不加 /v1', () => {
    expect(newChannel('deepseek')).toMatchObject({ protocol: 'deepseek', baseUrl: 'https://api.deepseek.com', defaultModel: '' });
    expect(defaultUrls.deepseek).toBe('https://api.deepseek.com');
    expect(isOpenAiCompatible('deepseek')).toBe(true);
    expect(isOpenAiCompatible('openai')).toBe(true);
    expect(isOpenAiCompatible('anthropic')).toBe(false);
    expect(AiConfigSchema.safeParse(defaultAiConfig()).success).toBe(true);
  });

  it('存取配置、四阶段路由保留 deepseek，不把密钥放进配置', () => {
    const a = setup(), config = defaultAiConfig(), disk = memory();
    config.channels = [a.channel]; config.routes.story = { channelId: a.channel.id, modelId: '' };
    saveAiConfig(disk, config);
    const restored = readAiConfig(disk);
    expect(restored.channels[0]).toEqual(a.channel);
    for (const stage of ['story', 'variables', 'world', 'memory'] as const)
      expect(requestSnapshot(restored, stage, a.vault).channel.protocol).toBe('deepseek');
    expect(JSON.stringify(restored)).not.toContain('mock-secret-do-not-send');
  });

  it('官方 /chat/completions 和 Bearer 鉴权，不误走 Anthropic', () => {
    const a = setup(), wire = wireRequest(a.snapshot(), messages, false);
    const body = JSON.parse(String(wire.init.body)) as Record<string, unknown>;
    const headers = new Headers(wire.init.headers);
    expect(wire.url).toBe('https://api.deepseek.com/chat/completions');
    expect(headers.get('Authorization')).toBe('Bearer mock-secret-do-not-send');
    expect(headers.has('x-api-key')).toBe(false);
    expect(headers.has('anthropic-version')).toBe(false);
    expect(body.messages).toEqual(messages);
    expect(body).toMatchObject({ model: 'deepseek-flash', stream: false, max_tokens: 8192 });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(JSON.stringify(body)).not.toContain('mock-secret-do-not-send');
    expect(payloadMessages(body, 'deepseek')).toEqual(messages);
  });

  it('World 可选 JSON 模式；Variables 不套用 JSON 模式', () => {
    const a = setup(); a.channel.compatibility.jsonMode = true;
    const world = JSON.parse(String(wireRequest(channelSnapshot(a.channel, a.vault, 'deepseek-flash', 'world'), messages, false).init.body));
    const variables = JSON.parse(String(wireRequest(channelSnapshot(a.channel, a.vault, 'deepseek-flash', 'variables'), messages, false).init.body));
    expect(world.response_format).toEqual({ type: 'json_object' });
    expect(variables).not.toHaveProperty('response_format');
  });

  it('非流式同时读取正文、原生思考与 usage；不会再发第二次请求', async () => {
    const a = setup(), fetcher = vi.fn<typeof fetch>(async () => Response.json(reply('你好，重庆', '先梳理背景')));
    const result = await new AiClient(fetcher).generate(a.snapshot(), messages);
    expect(result).toMatchObject({ protocol: 'deepseek', text: '你好，重庆', nativeReasoning: '先梳理背景',
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, reasoningTokens: 2 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('mock-secret-do-not-send');
  });

  it('流式 SSE 提取 reasoning_content 与正文，正常识别 [DONE]', async () => {
    const a = setup();
    const input = frame({ choices: [{ delta: { reasoning_content: '思考' } }] })
      + frame({ choices: [{ delta: { content: '开局' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(input), deltas: string[] = [], thoughts: string[] = [];
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
      controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const fetcher = vi.fn<typeof fetch>(async () => response);
    const result = await new AiClient(fetcher).generate(a.snapshot(), messages, {
      stream: true, onDelta: x => deltas.push(x), onReasoningDelta: x => thoughts.push(x) });
    expect(result).toMatchObject({ text: '开局', nativeReasoning: '思考' });
    expect(deltas.join('')).toBe('开局');
    expect(thoughts.join('')).toBe('思考');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('官方 GET /models 返回模型列表，不擅自附加 /v1', async () => {
    const a = setup();
    expect(modelListCandidates(a.snapshot())[0]).toBe('https://api.deepseek.com/models');
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ object: 'list',
      data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
    expect(await new AiClient(fetcher).listModels(a.snapshot())).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.deepseek.com/models');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer mock-secret-do-not-send');
  });

  it('中转忽略 stream 时支持整段 JSON，审核拒绝不伪装成流式中断', async () => {
    const a = setup(), deltas: string[] = [];
    const ok = new AiClient(async () => Response.json(reply('整段 JSON')));
    expect((await ok.generate(a.snapshot(), messages, { stream: true, onDelta: x => deltas.push(x) })).text).toBe('整段 JSON');
    expect(deltas).toEqual(['整段 JSON']);
    const rejected = new AiClient(async () => Response.json({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }));
    await expect(rejected.generate(a.snapshot(), messages)).rejects.toMatchObject({ code: 'content_filter' });
  });
});
it('DeepSeek 官方尾部内容块包含 usage，无需 include_usage，流式正文与思考均保留', async () => {
  const a = setup();
  // Official contract: usage is on the last single-choice chunk even when stream_options is absent.
  // https://api-docs.deepseek.com/api/create-chat-completion/#request
  const sse = frame({ choices: [{ delta: { reasoning_content: '核对上下文' } }] })
    + frame({ choices: [{ delta: { content: '正文' }, finish_reason: null }] })
    + frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: reply('').usage }) + 'data: [DONE]\n\n';
  const fetcher = vi.fn<typeof fetch>(async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
  const result = await new AiClient(fetcher).generate(a.snapshot(), messages, { stream: true });
  expect(result).toMatchObject({ text: '正文', nativeReasoning: '核对上下文',
    usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, reasoningTokens: 2 } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ stream: true, max_tokens: 8192 });
  expect(JSON.parse(String(wireRequest(a.snapshot(), messages, false).init.body))).not.toHaveProperty('stream_options');
});

it('四阶段独立模型选择保存/重载后仍走 DeepSeek，旧三协议渠道原样保留', () => {
  const a = setup(), disk = memory(), config = defaultAiConfig();
  const previous = ['openai', 'gemini', 'anthropic'].map(protocol => newChannel(protocol as 'openai' | 'gemini' | 'anthropic'));
  config.channels = [...previous, a.channel];
  config.routes.story = { channelId: a.channel.id, modelId: 'authored-story' };
  for (const stage of ['variables', 'world', 'memory'] as const)
    config.routes[stage] = { mode: 'independent', channelId: a.channel.id, modelId: `authored-${stage}` };
  saveAiConfig(disk, config);
  const restored = readAiConfig(disk);
  expect(restored.channels.slice(0, 3)).toEqual(previous);
  for (const stage of ['story', 'variables', 'world', 'memory'] as const) {
    const snapshot = requestSnapshot(restored, stage, a.vault);
    expect(snapshot).toMatchObject({ model: `authored-${stage}`, stage, channel: { protocol: 'deepseek' } });
    const sent = JSON.parse(String(wireRequest(snapshot, messages, false).init.body));
    expect(sent.model).toBe(`authored-${stage}`);
    expect(sent.max_tokens).toBe(8192); expect(sent).not.toHaveProperty('max_completion_tokens');
  }
});

it('DeepSeek 不学习 OpenAI max_completion_tokens 或丢弃玩家温度，也不自动重发', async () => {
  const a = setup(); a.channel.parameters.temperature = 0.7;
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: {
    code: 'unsupported_parameter', param: 'max_tokens',
    message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
  } }, { status: 400 }));
  const client = new AiClient(fetcher);
  await expect(client.generate(a.snapshot(), messages)).rejects.toMatchObject({ code: 'rejected', status: 400 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(client.generate(a.snapshot(), messages)).rejects.toMatchObject({ code: 'rejected' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const call of fetcher.mock.calls) {
    const sent = JSON.parse(String(call[1]?.body));
    expect(sent).toMatchObject({ max_tokens: 8192, temperature: 0.7 });
    expect(sent).not.toHaveProperty('max_completion_tokens');
  }
});

it.each(['length', 'content_filter'] as const)('DeepSeek SSE %s 保留失败类别，不自动重试', async reason => {
  const a = setup();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(frame({ choices: [{ delta: { content: '片段' }, finish_reason: reason }] }),
    { headers: { 'content-type': 'text/event-stream' } }));
  await expect(new AiClient(fetcher).generate(a.snapshot(), messages, { stream: true }))
    .rejects.toMatchObject({ code: reason === 'length' ? 'output_limit' : 'content_filter' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
