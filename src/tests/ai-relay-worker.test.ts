import { expect, it, vi } from 'vitest';
import { aiRelay } from '../aiRelay';
import worker from '../worker';
const origin = 'https://game.example',
  base = 'https://open.bigmodel.cn/api/paas/v4';
const endpoint = (target: string) => origin + '/api/ai-relay?target=' + encodeURIComponent(target);
it.each([
  'http://example.com',
  'https://127.0.0.1',
  'https://[::1]',
  'https://[::ffff:127.0.0.1]',
  'https://172.20.1.1',
  'https://example.com:9443',
  'https://localhost.',
  'https://game.example',
  'https://login:secret@example.com',
  'https://x.workers.dev',
])('拒绝目标 %s', async (host) => {
  const send = vi.fn<typeof fetch>();
  expect((await aiRelay(new Request(endpoint(host + '/models')), send)).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
it('方法、路径、来源和大小限制在转发前生效，公告路由仍可用', async () => {
  const send = vi.fn<typeof fetch>(),
    assets = vi.fn<typeof fetch>();
  for (const [url, init, status] of [
    [base + '/models', { method: 'DELETE' }, 405],
    [base + '/unrelated', {}, 400],
    [base + '/chat/completions', {}, 400],
    [base + '/models', { headers: { Origin: 'https://other.example' } }, 403],
    [base + '/chat/completions', { method: 'POST', body: 'a'.repeat(2 * 1024 * 1024 + 1) }, 413],
  ] as const)
    expect((await aiRelay(new Request(endpoint(url), init), send)).status).toBe(status);
  expect(send).not.toHaveBeenCalled();
  expect(
    (
      await worker.fetch(new Request(endpoint(base + '/models'), { method: 'OPTIONS' }), {
        ASSETS: { fetch: assets },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await worker.fetch(new Request(origin + '/api/announcement'), { ASSETS: { fetch: assets } })
    ).headers.get('X-Announcement-Source'),
  ).toBe('builtin');
  expect(assets).not.toHaveBeenCalled();
});
it('逐块转发 SSE，无需等待结束；仅必要头进入上游', async () => {
  let producer!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      producer = c;
    },
  });
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'secret' } }),
    );
  const request = new Request(endpoint(base + '/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer synthetic',
      'x-api-key': 'synthetic',
      Cookie: 'private',
      'Content-Type': 'application/json',
    },
    body: '{"stream":true}',
  });
  const response = await aiRelay(request, send);
  expect(response.headers.get('set-cookie')).toBeNull();
  const [url, init] = send.mock.calls[0];
  expect(url).toBe(base + '/chat/completions');
  expect(init?.redirect).toBe('manual');
  expect(new Headers(init?.headers).get('Cookie')).toBeNull();
  expect(new Headers(init?.headers).get('x-api-key')).toBe('synthetic');
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic');
  expect(await new Response(init?.body).text()).toBe('{"stream":true}');
  const reader = response.body!.getReader();
  producer.enqueue(Uint8Array.of(1));
  expect((await reader.read()).value).toEqual(Uint8Array.of(1));
  producer.enqueue(Uint8Array.of(2));
  producer.close();
  expect((await reader.read()).value).toEqual(Uint8Array.of(2));
  expect((await reader.read()).done).toBe(true);
});
it('透传上游 HTTP 错误正文，拒绝重定向且不转发 Location', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ error: 'test' }, { status: 429 }))
    .mockResolvedValueOnce(Response.redirect('https://other.example'));
  const request = new Request(endpoint(base + '/models'));
  const first = await aiRelay(request, send);
  expect(first.status).toBe(429);
  expect(await first.json()).toEqual({ error: 'test' });
  const second = await aiRelay(request, send);
  expect(second.status).toBe(502);
  expect(second.headers.get('location')).toBeNull();
  expect(send).toHaveBeenCalledTimes(2);
});
