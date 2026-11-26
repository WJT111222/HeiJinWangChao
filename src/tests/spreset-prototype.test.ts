import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readPrototypeResponse } from '../presets/spreset/response';
import { definition, readPrototype } from '../presets/spreset/definition';
import type { Protocol } from '../services/ai/configuration';
import { loadPreset } from '../presets/package';

const fixture = '测试正文', signal = new AbortController().signal;
const request = { messages: [{ role: 'user', content: '核对瓷杯' }], stream: true, chat_completion_source: 'custom' };
const kernel = new URL('../../experiments/spreset/core.mjs', import.meta.url);
const start = async (): Promise<(op: string, input: unknown) => unknown> => (await import(kernel.href)).createSession();
const sse = (...events: string[]) => new Response(events.map(e => 'data: ' + e + '\n\n').join(''));
const call = { id: 'issued', name: 'submit_scene', args: { content: fixture } };

describe('SPreset 请求独立生命周期', () => {
  it('加载受锁定版本的原件与本地组件，只有显式的文学配置进入配置快照', async () => {
    const sources = JSON.parse(await readFile(new URL('../../experiments/spreset/SOURCES.json', import.meta.url), 'utf8'));
    for (const [file, sha] of Object.entries(sources.localFiles)) {
      const bytes = await readFile(new URL('../../experiments/spreset/' + file, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
    }
    const code = await readFile(kernel, 'utf8');
    const exact = code.slice(code.indexOf('function normalizeSPresetOutputProcessorResult'), code.indexOf('// The original output')).trimEnd() + '\n';
    expect(createHash('sha256').update(exact).digest('hex')).toBe(sources.sections['normalizeSPresetOutputProcessorResult:916-943']);
    expect(createHash('sha256').update(sources.localFiles['core.mjs'] + sources.localFiles['worker.mjs'] + sources.localFiles['frame.mjs']).digest('hex')).toBe(sources.edition);
    expect(definition.version).toBe('c2.2-' + sources.edition);
    const loaded = loadPreset(await readPrototype(), definition);
    expect(loaded.scripts).toEqual([]);
    expect(loaded.entries.filter(e => e.enabled).map(e => e.identifier)).toContain('chatHistory');
  });
  it('一次初始化、一次合法本地工具执行、一次收据，另一个会话独立', async () => {
    const a = await start(), b = await start();
    expect(() => b('finish', { call })).toThrow();
    expect(a('prepare', request)).toMatchObject({ tools: [{ function: { name: call.name } }], tool_choice: 'auto' });
    expect(request).not.toHaveProperty('tools');
    expect(a('finish', { call })).toEqual({ output: fixture, receipt: { id: call.id, bytes: Buffer.byteLength(fixture) } });
    expect(() => a('finish', { call })).toThrow();
    b('prepare', request);
    const raw = '<正文>保留 <think>引用</think> 原文。</正文>';
    expect(b('finish', { text: '<think>临时兼容文本</think>' + raw })).toEqual({ output: raw, receipt: null });
  });
  it.each([['unknown', { ...call, name: 'unknown' }], ['extra', { ...call, args: { content: fixture, extra: 1 } }],
    ['unparsed', { ...call, args: '{"content":' }], ['missing', { ...call, args: {} }]])('工具白名单和严格参数：%s', async (_, invocation) => {
    const run = await start(); run('prepare', request); expect(() => run('finish', { call: invocation })).toThrow();
  });
});

describe('真实供应商边界优先于输出处理器', () => {
  const completion = (finish: string, content = fixture) => Response.json({ choices: [{ message: { content }, finish_reason: finish }] });
  it.each([
    ['openai', () => completion('length'), 'output_limit'],
    ['openai', () => completion('unknown'), 'stream_interrupted'],
    ['openai', () => Response.json({ choices: [{ message: { content: fixture, refusal: 'declined' }, finish_reason: 'stop' }] }), 'content_filter'],
    ['gemini', () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), 'content_filter'],
    ['anthropic', () => Response.json({ content: [{ type: 'text', text: fixture }], stop_reason: 'max_tokens' }), 'output_limit'],
    ['anthropic', () => sse(JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })), 'stream_interrupted'],
    ['deepseek', () => sse('{"choices":[{"delta":{"content":"partial"}}]}', '[DONE]'), 'stream_interrupted'],
    ['openai', () => new Response('data: {"choices":[{"delta":{"content":"片段"}}]}\n\nevent: error\n\n'), 'rejected'],
    ['openai', () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'one', function: { name: call.name, arguments: '{"content":' } }] }, finish_reason: 'tool_calls' }] }), 'invalid_json'],
    ['gemini', () => Response.json({ candidates: [{ content: { parts: [{ functionCall: { name: call.name, args: {}, willContinue: true } }] }, finishReason: 'STOP' }] }), 'unsupported'],
    ['openai', () => Response.json({ choices: [{ message: { content: 'competing', tool_calls: [{ id: 'one', function: { name: call.name, arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), 'invalid_output'],
    ['deepseek', () => Response.json({ choices: [{ message: { reasoning_content: fixture }, finish_reason: 'stop' }] }), 'empty'],
  ] as const)('%s 遇到 %s 保留真实错误 %s', async (protocol, make, code) => {
    await expect(readPrototypeResponse(make(), protocol as Protocol, signal)).rejects.toMatchObject({ code });
  });
  it('普通截断原文可观察，未完成工具参数不会进入可续写正文', async () => {
    const observed: string[] = [];
    const observer = { onRawTextDelta: (s: string) => observed.push(s) };
    await expect(readPrototypeResponse(sse('{"choices":[{"delta":{"content":"<正文>未完"}}]}', '[DONE]'), 'openai', signal, observer))
      .rejects.toMatchObject({ code: 'stream_interrupted' });
    expect(observed).toEqual(['<正文>未完']);
    observed.length = 0;
    const partial = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', type: 'function', function: { name: call.name, arguments: '{"content":' } }] } }] };
    await expect(readPrototypeResponse(sse(JSON.stringify(partial), '[DONE]'), 'openai', signal, observer))
      .rejects.toMatchObject({ code: 'stream_interrupted' });
    expect(observed).toEqual([]);
  });
  it('保留供应商实际返回的公开思考和缓存统计，取消不产生交付', async () => {
    const data = { choices: [{ message: { content: fixture, reasoning_content: 'public' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 8, prompt_cache_hit_tokens: 32 } };
    const received = await readPrototypeResponse(Response.json(data), 'deepseek', signal);
    expect(received).toMatchObject({ text: fixture, reasoning: 'public', finish: 'stop', usage: { cacheReadTokens: 32, inputTokens: 90, outputTokens: 8 } });
    expect(received.call).toBeUndefined();
    const abort = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n')); } });
    const pending = readPrototypeResponse(new Response(stream), 'openai', abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

for (const protocol of ['openai', 'deepseek', 'gemini', 'anthropic'] as const) {
  it.each([false, true])(protocol + ' 完整纯文本经实际处理器正常交付，收据为空（stream=%s）', async streaming => {
    const content = '<正文>杯。</正文><短期记忆>核对杯子。</短期记忆><变量规划>[]</变量规划>';
    let json: unknown, events: unknown[];
    if (protocol === 'anthropic') {
      const block = { type: 'text', text: content };
      json = { type: 'message', role: 'assistant', content: [block], stop_reason: 'end_turn' };
      events = [{ type: 'message_start', message: { role: 'assistant' } },
        { type: 'content_block_start', index: 0, content_block: { ...block, text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } },
        { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
    } else if (protocol === 'gemini') {
      json = { candidates: [{ content: { role: 'model', parts: [{ text: content }] }, finishReason: 'STOP' }] };
      events = [json];
    } else {
      json = { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] };
      events = [{ choices: [{ delta: { role: 'assistant', content } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }];
    }
    const response = streaming ? sse(...events.map(e => JSON.stringify(e)),
      ...(protocol === 'openai' || protocol === 'deepseek' ? ['[DONE]'] : [])) : Response.json(json);
    const processor = await start();
    processor('prepare', request);
    const upstream = await readPrototypeResponse(response, protocol, signal);
    expect(upstream.text).toBe(content);
    expect(upstream.call).toBeUndefined();
    expect(processor('finish', { text: upstream.text, call: upstream.call })).toEqual({ output: content, receipt: null });
  });
}
