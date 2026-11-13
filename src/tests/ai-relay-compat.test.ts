import { beforeEach, describe, expect, it } from 'vitest';
import { AiClient } from '../services/ai/client';
import { channelSnapshot } from '../services/ai/snapshot';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { clearAdjustedParameters } from '../services/ai/compat';
import { ModelCatalog } from '../ui/settings/modelCatalog';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
function configured(protocol: Protocol) {
  const vault = new CredentialVault(memory(), memory());
  const channel = { ...newChannel(protocol), defaultModel: 'mock-model' };
  const config = defaultAiConfig(); config.channels = [channel];
  vault.set(channel.id, 'mock-key-not-real');
  return { vault, channel };
}
function sseResponse(data: string, byteSize = 3) {
  const bytes = new TextEncoder().encode(data);
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (index >= bytes.length) controller.close();
    else { controller.enqueue(bytes.slice(index, index + byteSize)); index += byteSize; }
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
beforeEach(() => clearAdjustedParameters());

// 官方接口与常见中转站的真实返回差异。这里只模拟响应形状，不证明某个服务一定可用。
const messages = [{ role: 'system' as const, content: '系统规则' }, { role: 'user' as const, content: '玩家行动' }];
function setup(protocol: Protocol = 'openai', baseUrl?: string) {
  const s = configured(protocol);
  const channel = { ...s.channel, ...(baseUrl ? { baseUrl } : {}) };
  return { snapshot: () => channelSnapshot(channel, s.vault), channel };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const raw = (text: string, type: string) => new Response(text, { headers: { 'Content-Type': type } });
function client(...responses: Response[]) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const transport = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error('no response');
    return next;
  }) as typeof fetch;
  return { ai: new AiClient(transport), sent };
}
const reply = (content: string, finish = 'stop') => ({ choices: [{ message: { content }, finish_reason: finish }] });

describe('OpenAI 兼容：结束原因', () => {
  it.each(['stop', 'end_turn', 'stop_sequence', 'STOP', 'eos', 'eos_token'])('正常结束 %s 都接受', async finish => {
    const { ai } = client(json(reply('正文', finish)));
    await expect(ai.generate(setup().snapshot(), messages)).resolves.toMatchObject({ text: '正文' });
  });
  it.each(['length', 'max_tokens', 'MAX_TOKENS'])('输出上限 %s 报 output_limit', async finish => {
    const { ai } = client(json(reply('半截', finish)));
    await expect(ai.generate(setup().snapshot(), messages)).rejects.toMatchObject({ code: 'output_limit' });
  });
  it.each(['content_filter', 'sensitive', 'safety', 'refusal'])('内容审核 %s 单独提示，不再显示成「流式中断」', async finish => {
    const { ai } = client(json(reply('', finish)));
    await expect(ai.generate(setup().snapshot(), messages)).rejects.toMatchObject({ code: 'content_filter' });
  });
});

describe('OpenAI 兼容：流式差异', () => {
  it('没有 [DONE]、但最后一块带 finish_reason=stop 并正常关闭', async () => {
    const { ai } = client(sseResponse(frame({ choices: [{ delta: { content: '你' } }] }) + frame({ choices: [{ delta: { content: '好' }, finish_reason: 'stop' }] })));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true })).resolves.toMatchObject({ text: '你好' });
  });
  it('[DONE] 后面没有空行就关闭连接', async () => {
    const { ai } = client(sseResponse(frame({ choices: [{ delta: { content: '你好' } }] }) + 'data: [DONE]'));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true })).resolves.toMatchObject({ text: '你好' });
  });
  it('既没有 [DONE] 也没有结束原因，仍然判为不完整', async () => {
    const { ai } = client(sseResponse(frame({ choices: [{ delta: { content: '你' } }] })));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true })).rejects.toMatchObject({ code: 'stream_interrupted' });
  });
  it('中转忽略 stream:true、直接返回完整 JSON', async () => {
    const deltas: string[] = [];
    const { ai } = client(json(reply('完整正文')));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true, onDelta: d => deltas.push(d) })).resolves.toMatchObject({ text: '完整正文' });
    expect(deltas.join('')).toBe('完整正文');
  });
  it('Content-Type 写错（text/plain）但正文是 SSE', async () => {
    const { ai } = client(raw(frame({ choices: [{ delta: { content: '你好' } }] }) + 'data: [DONE]\n\n', 'text/plain; charset=utf-8'));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true })).resolves.toMatchObject({ text: '你好' });
  });
  it('流式中的结束原因 end_turn（Claude 经 OpenAI 格式中转）', async () => {
    const { ai } = client(sseResponse(frame({ choices: [{ delta: { content: '你好' }, finish_reason: 'end_turn' }] }) + 'data: [DONE]\n\n'));
    await expect(ai.generate(setup().snapshot(), messages, { stream: true })).resolves.toMatchObject({ text: '你好' });
  });
});

describe('推理模型把思考写进正文 <think>…</think>', () => {
  it('非流式：去掉开头的 <think> 块，并作为原生思考保留', async () => {
    const { ai } = client(json(reply('<think>\n先想想\n</think>\n\n<thinking>规划</thinking><正文>内容</正文>')));
    const result = await ai.generate(setup().snapshot(), messages);
    expect(result.text).toBe('<thinking>规划</thinking><正文>内容</正文>');
    expect(result.nativeReasoning).toBe('\n先想想\n');
  });
  it('流式：<think> 标签被拆在多个分块里也能分离', async () => {
    const parts = ['<th', 'ink>想', '一想</th', 'ink>', '\n<thinking>规划', '</thinking>'];
    const body = parts.map(content => frame({ choices: [{ delta: { content } }] })).join('') + 'data: [DONE]\n\n';
    const deltas: string[] = [], reasoning: string[] = [];
    const { ai } = client(sseResponse(body, 5));
    const result = await ai.generate(setup().snapshot(), messages, { stream: true, onDelta: d => deltas.push(d), onReasoningDelta: d => reasoning.push(d) });
    expect(result.text).toBe('<thinking>规划</thinking>');
    expect(deltas.join('')).toBe('<thinking>规划</thinking>');
    expect(reasoning.join('')).toBe('想一想');
  });
  it('只处理开头；正文中间出现 <think> 原样保留，项目自己的 <thinking> 不受影响', async () => {
    const { ai } = client(json(reply('<thinking>规划<think>不是推理</think></thinking>')));
    expect((await ai.generate(setup().snapshot(), messages)).text).toBe('<thinking>规划<think>不是推理</think></thinking>');
  });
  it('原生 reasoning_content 已经给出时，不重复拼接', async () => {
    const { ai } = client(json({ choices: [{ message: { content: '<think>甲</think>正文', reasoning_content: '甲' }, finish_reason: 'stop' }] }));
    const result = await ai.generate(setup().snapshot(), messages);
    expect(result.text).toBe('正文');
    expect(result.nativeReasoning).toBe('甲');
  });
});

describe('OpenAI 官方新模型的输出上限字段', () => {
  it('官方地址 api.openai.com 使用 max_completion_tokens', async () => {
    const { ai, sent } = client(json(reply('好')));
    await ai.generate(setup('openai', 'https://api.openai.com/v1').snapshot(), messages);
    expect(sent[0].body).toMatchObject({ max_completion_tokens: 8192 });
    expect(sent[0].body).not.toHaveProperty('max_tokens');
  });
  it('其他地址仍用 max_tokens；明确报不支持后，下一次改用 max_completion_tokens，不自动重发', async () => {
    const { snapshot } = setup('openai', 'https://relay.example.com/v1');
    const { ai, sent } = client(
      json({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", param: 'max_tokens', code: 'unsupported_parameter' } }, 400),
      json(reply('好')));
    await expect(ai.generate(snapshot(), messages)).rejects.toMatchObject({ code: 'parameter_adjusted' });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toHaveProperty('max_tokens', 8192);
    await ai.generate(snapshot(), messages);
    expect(sent[1].body).toMatchObject({ max_completion_tokens: 8192 });
    expect(sent[1].body).not.toHaveProperty('max_tokens');
  });
});

describe('原生 Gemini / Anthropic 的安全拦截', () => {
  it('Gemini 输入被拦截（promptFeedback.blockReason）', async () => {
    const { ai } = client(json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }));
    await expect(ai.generate(setup('gemini').snapshot(), messages)).rejects.toMatchObject({ code: 'content_filter' });
  });
  it('Gemini 输出被拦截（finishReason SAFETY）', async () => {
    const { ai } = client(json({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }));
    await expect(ai.generate(setup('gemini').snapshot(), messages)).rejects.toMatchObject({ code: 'content_filter' });
  });
  it('Gemini 流式中被拦截', async () => {
    const { ai } = client(sseResponse(frame({ candidates: [{ content: { parts: [{ text: '开' }] } }] }) + frame({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] })));
    await expect(ai.generate(setup('gemini').snapshot(), messages, { stream: true })).rejects.toMatchObject({ code: 'content_filter' });
  });
  it('Anthropic stop_reason=refusal', async () => {
    const { ai } = client(json({ content: [], stop_reason: 'refusal' }));
    await expect(ai.generate(setup('anthropic').snapshot(), messages)).rejects.toMatchObject({ code: 'content_filter' });
  });
});

describe('中转站地址漏写 /v1', () => {
  it('模型列表靠备用路径找到时，提示生成请求仍按原地址发送', async () => {
    const { channel, vault } = configured('openai');
    const target = { ...channel, baseUrl: 'https://relay.example.com' };
    const urls: string[] = [];
    const transport = (async (url: string) => { urls.push(url); return url.endsWith('/v1/models') ? json({ data: [{ id: 'model-a' }] }) : new Response('not found', { status: 404 }); }) as typeof fetch;
    const catalog = new ModelCatalog(new AiClient(transport));
    await catalog.load(target, vault, 10);
    expect(urls).toEqual(['https://relay.example.com/models', 'https://relay.example.com/v1/models']);
    expect(catalog.getSnapshot()[target.id]).toMatchObject({ status: 'ready', models: ['model-a'] });
    expect(catalog.getSnapshot()[target.id].message).toContain('列表是在备用路径找到的');
  });
  it('地址本身正确时不出现这条提示', async () => {
    const { channel, vault } = configured('openai');
    const target = { ...channel, baseUrl: 'https://relay.example.com/v1' };
    const catalog = new ModelCatalog(new AiClient((async () => json({ data: [{ id: 'model-a' }] })) as typeof fetch));
    await catalog.load(target, vault, 10);
    expect(catalog.getSnapshot()[target.id].message).not.toContain('备用路径');
  });
});
