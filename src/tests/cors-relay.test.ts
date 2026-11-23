import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { channelSnapshot } from '../services/ai/snapshot';
import { CredentialVault } from '../services/ai/credentials';
import { newChannel, type AiTask } from '../services/ai/configuration';
import { setRelayMode } from '../services/ai/corsRelay';
import { transientStageError } from '../workflows/turnCoordinator';
import { variableFailure } from '../services/validation/variableDiagnostics';

const origin = 'https://game.example',
  base = 'https://open.bigmodel.cn/api/paas/v4';
const messages = [{ role: 'user' as const, content: '合成测试' }];
const reply = () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
function forwarded(response: Response) {
  response.headers.set('X-Heijin-Relay-Upstream', '1');
  return response;
}
const failed = () => new TypeError('Failed to fetch');
let vault: CredentialVault;
function snapshot(stage: AiTask = 'story') {
  const channel = { ...newChannel(), baseUrl: base, defaultModel: 'glm-mock' };
  vault.set(channel.id, 'synthetic-key');
  return channelSnapshot(channel, vault, channel.defaultModel, stage);
}
beforeEach(() => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, v: string) => {
      data.set(key, v);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  vi.stubGlobal('window', { location: new URL(origin) });
  vi.stubGlobal('localStorage', storage);
  vault = new CredentialVault(storage, storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('直连成功只发一次', async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValue(reply());
  expect((await new AiClient(send).generate(snapshot(), messages)).text).toBe('OK');
  expect(send.mock.calls.map((c) => c[0])).toEqual([base + '/chat/completions']);
});
it.each(['story', 'variables', 'world', 'memory'] as const)(
  '%s 无状态网络错误在同域按原请求回退一次',
  async (stage) => {
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(failed()).mockResolvedValueOnce(forwarded(reply()));
    expect((await new AiClient(send).generate(snapshot(stage), messages)).text).toBe('OK');
    const url = base + '/chat/completions';
    expect(send.mock.calls.map((c) => String(c[0]))).toEqual([
      url,
      origin + '/api/ai-relay?target=' + encodeURIComponent(url),
    ]);
    expect(send.mock.calls[1][1]).toEqual(send.mock.calls[0][1]);
  },
);
it.each([400, 401, 403, 404, 429, 500])(
  '收到 HTTP %i 后保留错误、不切换路径且不触发外层重试',
  async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    const error = await new AiClient(send).generate(snapshot(), messages).catch((e) => e);
    expect(error.status).toBe(status);
    expect(transientStageError(error)).toBe(false);
    expect(transientStageError(variableFailure(error, 'request'))).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  },
);
it('关闭中转保留原有网络失败与 500 策略', async () => {
  setRelayMode('off');
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(failed())
    .mockResolvedValueOnce(new Response(null, { status: 500 }));
  const client = new AiClient(send),
    route = snapshot();
  await expect(client.generate(route, messages)).rejects.toMatchObject({ code: 'network' });
  expect(transientStageError(await client.generate(route, messages).catch((e) => e))).toBe(true);
  expect(send.mock.calls.map((c) => c[0])).toEqual([
    base + '/chat/completions',
    base + '/chat/completions',
  ]);
});
it.each([400, 401, 403, 404, 429, 500])('中转上游 HTTP %i 保留直连错误语义且不再发送', async status => {
  const send = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status }))
    .mockRejectedValueOnce(failed())
    .mockResolvedValueOnce(forwarded(new Response(null, { status })));
  const client = new AiClient(send), route = snapshot();
  const direct = await client.generate(route, messages).catch(e => e);
  const relayed = await client.generate(route, messages).catch(e => e);
  expect(relayed).toMatchObject({ code: direct.code, status });
  expect(relayed.details).toEqual(direct.details);
  expect(transientStageError(relayed)).toBe(false);
  expect(send).toHaveBeenCalledTimes(3);
});
it('中转列表的下一页直连成功，无需中转响应标识', async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValueOnce(failed())
    .mockResolvedValueOnce(forwarded(Response.json({ data: [{ id: 'a' }], next_cursor: 'next' })))
    .mockResolvedValueOnce(Response.json({ data: [{ id: 'b' }] }));
  expect(await new AiClient(send).listModels(snapshot())).toEqual(['a', 'b']);
  expect(send.mock.calls[2][0]).toBe(base + '/models?cursor=next');
  expect(send).toHaveBeenCalledTimes(3);
});
it.each([200, 404])('站点路由返回 HTTP %i 的页面时，准确报告中转不可用', async status => {
  const send = vi.fn<typeof fetch>().mockRejectedValueOnce(failed()).mockResolvedValueOnce(
    new Response('synthetic-private-page', { status, headers: { 'Content-Type': 'text/html' } }),
  );
  const error = await new AiClient(send).generate(snapshot(), messages).catch(e => e);
  expect(error).toMatchObject({ code: 'network', status, details: { fieldPath: 'channel.relay_unavailable' } });
  expect(error.message).not.toContain('synthetic-private-page');
  expect(transientStageError(error)).toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
});
it('列表 GET 走中转；中转再失败也不探测其他候选端点', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(failed())
    .mockResolvedValueOnce(forwarded(Response.json({ data: [{ id: 'glm-mock' }] })))
    .mockRejectedValueOnce(failed())
    .mockRejectedValueOnce(failed());
  const list = () => new AiClient(send).listModels(snapshot());
  expect(await list()).toEqual(['glm-mock']);
  await expect(list()).rejects.toMatchObject({
    code: 'network',
    details: { fieldPath: 'channel.relay' },
  });
  expect(send.mock.calls.map((c) => c[0])).toEqual(
    Array(2)
      .fill([base + '/models', origin + '/api/ai-relay?target=' + encodeURIComponent(base + '/models')])
      .flat(),
  );
});
it('流式回退继续读取 SSE，取得响应后流中断不再回退', async () => {
  const frame = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n';
  const stream = (s: string) => new Response(s, { headers: { 'Content-Type': 'text/event-stream' } });
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(failed())
    .mockResolvedValueOnce(forwarded(stream(frame + 'data: [DONE]\n\n')))
    .mockResolvedValueOnce(stream(frame));
  const generate = () => new AiClient(send).generate(snapshot(), messages, { stream: true });
  expect((await generate()).text).toBe('OK');
  await expect(generate()).rejects.toMatchObject({ code: 'stream_interrupted' });
  expect(send).toHaveBeenCalledTimes(3);
});
it.each(['cancelled', 'timeout'])('%s 与网络错误竞争时不补发', async (code) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const send = vi.fn<typeof fetch>(
    (_, init) =>
      new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(failed()))),
  );
  const done = expect(
    new AiClient(send).generate(snapshot(), messages, { signal: controller.signal, timeoutSeconds: 1 }),
  ).rejects.toMatchObject({ code });
  if (code === 'cancelled') controller.abort();
  else await vi.advanceTimersByTimeAsync(1000);
  await done;
  expect(send).toHaveBeenCalledTimes(1);
});
