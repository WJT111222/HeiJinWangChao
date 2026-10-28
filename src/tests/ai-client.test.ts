import { describe, it, expect, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import {
  defaultAiConfig,
  newChannel,
  AiConfigSchema,
  readAiConfig,
  saveAiConfig,
  removeChannel,
} from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestSnapshot, channelSnapshot } from '../services/ai/snapshot';
import { safeAiError } from '../services/ai/errors';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';

export function store() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    values: () => [...data.values()],
  };
}
export function configured(protocol: Protocol = 'openai') {
  const session = store(),
    persistent = store();
  const vault = new CredentialVault(session, persistent);
  const channel = { ...newChannel(protocol), defaultModel: 'mock-model' };
  const config = defaultAiConfig();
  config.channels = [channel];
  config.routes.story = { channelId: channel.id, modelId: '' };
  vault.set(channel.id, 'mock-key-not-real');
  return { session, persistent, vault, channel, config };
}
const messages = [
  { role: 'system' as const, content: '系统规则' },
  { role: 'user' as const, content: '测试数据' },
];
function normal(protocol: Protocol) {
  return protocol === 'openai'
    ? {
        choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }
    : protocol === 'gemini'
      ? {
          candidates: [{ content: { parts: [{ text: '你好' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
        }
      : {
          content: [
            { type: 'thinking', thinking: '不应展示' },
            { type: 'text', text: '你好' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 2 },
        };
}
export function sseResponse(data: string, byteSize = 3) {
  const bytes = new TextEncoder().encode(data);
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= bytes.length) controller.close();
        else {
          controller.enqueue(bytes.slice(index, index + byteSize));
          index += byteSize;
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}
export const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

describe('渠道、凭证与请求快照', () => {
  it('旧 V1 设置无需迁移，新增配置独立保存多渠道、路由与参数，不带密钥', () => {
    const setup = configured();
    const storage = store();
    const old = defaultSettings();
    expect(SettingsSchema.parse(JSON.parse(JSON.stringify(old)))).toEqual(old);
    const second = { ...newChannel('gemini'), defaultModel: 'other-model' };
    setup.config.channels.push(second);
    setup.config.routes.world = {
      mode: 'independent',
      channelId: second.id,
      modelId: 'override-model',
    };
    saveAiConfig(storage, setup.config);
    expect(readAiConfig(storage)).toEqual(setup.config);
    expect(JSON.stringify(storage.values())).not.toContain('mock-key-not-real');
    setup.vault.set(second.id, 'another-mock-key');
    expect(requestSnapshot(setup.config, 'variables', setup.vault).model).toBe('mock-model');
    expect(requestSnapshot(setup.config, 'world', setup.vault).model).toBe('override-model');
    expect(removeChannel(setup.config, second.id).routes.world).toEqual({ mode: 'follow-story' });
    expect(readAiConfig(store()).channels).toEqual([]);
  });
  it('凭证默认会话级，长期记住只在显式选择时；删除或撤回会清理持久副本', () => {
    const a = configured();
    expect(a.persistent.values()).toEqual([]);
    expect(a.vault.remembered(a.channel.id)).toBe(false);
    a.vault.set(a.channel.id, 'remembered-mock', true);
    expect(a.session.values()).toEqual([]);
    expect(a.vault.remembered(a.channel.id)).toBe(true);
    a.vault.set(a.channel.id, 'session-mock');
    expect(a.persistent.values()).toEqual([]);
    a.vault.delete(a.channel.id);
    expect(a.vault.get(a.channel.id)).toBe('');
  });
  it('冻结路由、参数和凭证，序列化快照不会带密钥，后续编辑不影响请求', async () => {
    const a = configured();
    const snapshot = requestSnapshot(a.config, 'story', a.vault);
    a.config.channels[0].defaultModel = 'changed';
    a.config.channels[0].parameters.temperature = 1.2;
    a.vault.set(a.channel.id, 'new-mock-key');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(normal('openai')));
    await new AiClient(transport).generate(snapshot, messages);
    expect(snapshot.model).toBe('mock-model');
    expect(Object.isFrozen(snapshot.channel.parameters)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('mock-key');
    expect(new Headers(transport.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer mock-key-not-real',
    );
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string).temperature).toBeUndefined();
  });
  it.each([
    'not-a-url',
    'https://key@example.com/v1',
    'https://example.com/v1?key=mock',
    'http://remote.example/v1',
  ])('拒绝带凭证、查询参数或非本机明文地址 %s', (baseUrl) => {
    const a = configured();
    a.config.channels[0].baseUrl = baseUrl;
    expect(AiConfigSchema.safeParse(a.config).success).toBe(false);
    expect(() => requestSnapshot(a.config, 'story', a.vault)).toThrow();
  });
});
describe('三种原生协议与响应规范化', () => {
  it('默认浏览器 transport 以 globalThis 调用 fetch，避免非法接收者', async () => {
    const a = configured();
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(Response.json(normal('openai')));
    });
    try {
      expect(
        (await new AiClient().generate(requestSnapshot(a.config, 'story', a.vault), messages)).text,
      ).toBe('你好');
    } finally {
      fetcher.mockRestore();
    }
  });
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 请求使用真实端点/角色/头，响应只取正文和真实 usage',
    async (protocol) => {
      const a = configured(protocol);
      const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(normal(protocol)));
      const response = await new AiClient(transport).generate(
        requestSnapshot(a.config, 'story', a.vault),
        messages,
      );
      const [url, init] = transport.mock.calls[0];
      const body = JSON.parse(init!.body as string);
      const headers = new Headers(init!.headers);
      expect(response.text).toBe('你好');
      expect(response.usage?.inputTokens).toBe(4);
      expect(response.usage?.outputTokens).toBe(2);
      expect(String(url)).not.toContain('mock-key');
      expect(JSON.stringify(body)).not.toContain('mock-key');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      if (protocol === 'openai') {
        expect(String(url)).toMatch(/\/v1\/chat\/completions$/);
        expect(body.messages).toEqual(messages);
        expect(headers.get('Authorization')).toContain('mock-key-not-real');
      }
      if (protocol === 'gemini') {
        expect(String(url)).toContain('/v1beta/models/mock-model:generateContent');
        expect(body.systemInstruction.parts[0].text).toBe('系统规则');
        expect(body.contents[0].role).toBe('user');
        expect(headers.get('x-goog-api-key')).toBe('mock-key-not-real');
        expect(headers.has('Authorization')).toBe(false);
      }
      if (protocol === 'anthropic') {
        expect(String(url)).toMatch(/\/v1\/messages$/);
        expect(body.system).toBe('系统规则');
        expect(body.messages).toEqual([messages[1]]);
        expect(body.max_tokens).toBe(8192);
        expect(headers.get('anthropic-version')).toBe('2023-06-01');
        expect(headers.get('x-api-key')).toBe('mock-key-not-real');
      }
    },
  );
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 获取模型列表，失败仍可由调用者手填 ID',
    async (protocol) => {
      const a = configured(protocol);
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            protocol === 'gemini'
              ? { models: [{ name: 'models/demo' }] }
              : { data: [{ id: 'demo' }] },
          ),
        );
      expect(await new AiClient(transport).listModels(channelSnapshot(a.channel, a.vault))).toEqual(
        ['demo'],
      );
      expect(String(transport.mock.calls[0][0])).toContain('/models');
    },
  );
  it('不支持参数显式跳过并诊断，Anthropic 不伪造 response_format', async () => {
    const a = configured('anthropic');
    a.channel.parameters.temperature = 1.5;
    a.channel.compatibility.jsonMode = true;
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(normal('anthropic')));
    const response = await new AiClient(transport).generate(
      channelSnapshot(a.channel, a.vault, 'mock-model', 'variables'),
      messages,
    );
    const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(response.diagnostics).toContain('TEMPERATURE_SKIPPED_UNSUPPORTED');
    expect(response.diagnostics).toContain('VARIABLE_TEXT_MODE_JSON_DISABLED');
  });
  it('COT新渠道默认完整历史，旧off保留，Prefix降级且不按模型名单猜测能力', () => {
    const a = configured();
    expect(requestSnapshot(a.config, 'story', a.vault).useCot).toBe(true);
    a.channel.compatibility.cotMode = 'off';
    expect(requestSnapshot(a.config, 'story', a.vault).useCot).toBe(false);
    a.channel.compatibility.cotMode = 'confirmation';
    a.channel.compatibility.cotModels = ['mock-model'];
    expect(requestSnapshot(a.config, 'story', a.vault).useCot).toBe(true);
    expect(requestSnapshot(a.config, 'variables', a.vault).useCot).toBe(false);
    a.channel.compatibility.cotMode = 'prefix';
    expect(requestSnapshot(a.config, 'story', a.vault).useCot).toBe(true);
    expect(requestSnapshot(a.config, 'story', a.vault).diagnostics).toContain('COT_PREFIX_FALLBACK_COMPLETE_HISTORY');
    a.channel.compatibility.cotMode = 'confirmation';
    a.channel.defaultModel = 'deepseek-test';
    a.channel.compatibility.cotModels = [];
    expect(requestSnapshot(a.config, 'story', a.vault).useCot).toBe(true);
  });
});
describe('安全错误、取消、超时和流式分片', () => {
  it.each([
    [401, 'authorization'],
    [403, 'authorization'],
    [404, 'not_found'],
    [429, 'rate_limit'],
    [500, 'server'],
    [400, 'rejected'],
  ] as const)('%s 错误不回显供应商正文中的密钥', async (status, code) => {
    const a = configured();
    const client = new AiClient(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('mock-key-not-real private detail', { status })),
    );
    try {
      await client.generate(requestSnapshot(a.config, 'story', a.vault), messages);
      expect.fail();
    } catch (error) {
      const safe = safeAiError(error);
      expect(safe.code).toBe(code);
      expect(JSON.stringify(safe)).not.toContain('mock-key');
      expect(JSON.stringify(safe)).not.toContain('private detail');
    }
  });
  it('浏览器网络失败准确保留 CORS/网络不确定性，不误报密钥错误', async () => {
    const a = configured();
    const client = new AiClient(
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError('mock-key-not-real')),
    );
    await expect(
      client.generate(requestSnapshot(a.config, 'story', a.vault), messages),
    ).rejects.toMatchObject({ code: 'network' });
    expect(safeAiError(new Error('secret')).message).not.toContain('secret');
  });
  it('超时及取消均结束挂起请求，提前取消不发送', async () => {
    const a = configured();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const client = new AiClient(fetcher),
      snap = requestSnapshot(a.config, 'story', a.vault);
    await expect(client.generate(snap, messages, { timeoutSeconds: 0.01 })).rejects.toMatchObject({
      code: 'timeout',
    });
    const controller = new AbortController();
    const pending = client.generate(snap, messages, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    const calls = fetcher.mock.calls.length;
    await expect(
      client.generate(snap, messages, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher.mock.calls.length).toBe(calls);
  });
  it.each(['openai', 'gemini', 'anthropic'] as const)(
    '%s 流式 UTF-8 每字节切片保持中文及结束语义',
    async (protocol) => {
      const a = configured(protocol);
      const data =
        protocol === 'openai'
          ? frame({ choices: [{ delta: { content: '你好' } }] }) + 'data: [DONE]\n\n'
          : protocol === 'gemini'
            ? frame(normal('gemini'))
            : frame({ type: 'message_start', message: { usage: { input_tokens: 4 } } }) +
              frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }) +
              frame({ type: 'message_delta', usage: { output_tokens: 2 } }) +
              frame({ type: 'message_stop' });
      const onDelta = vi.fn();
      const response = await new AiClient(
        vi.fn<typeof fetch>().mockResolvedValue(sseResponse(data, 1)),
      ).generate(requestSnapshot(a.config, 'story', a.vault), messages, { stream: true, onDelta });
      expect(response.text).toBe('你好');
      expect(onDelta.mock.calls.flat().join('')).toBe('你好');
    },
  );
  it('中断 SSE、不合法 JSON 与空响应均不能成功', async () => {
    const a = configured();
    const snap = requestSnapshot(a.config, 'story', a.vault);
    await expect(
      new AiClient(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(sseResponse(frame({ choices: [{ delta: { content: '片段' } }] }))),
      ).generate(snap, messages, { stream: true }),
    ).rejects.toMatchObject({ code: 'stream_interrupted' });
    await expect(
      new AiClient(vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid'))).generate(
        snap,
        messages,
      ),
    ).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(
      new AiClient(
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [] })),
      ).generate(snap, messages),
    ).rejects.toMatchObject({ code: 'empty' });
  });
});
