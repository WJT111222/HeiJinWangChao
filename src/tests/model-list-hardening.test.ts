import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { defaultAiConfig, readAiConfig, saveAiConfig, newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { requestSnapshot, channelSnapshot } from '../services/ai/snapshot';
import { safeModelListEndpoint } from '../services/ai/modelListing';
import type { ModelListFailureDiagnostics } from '../services/ai/modelListing';
import { ModelCatalog } from '../ui/settings/modelCatalog';

function setup(protocol: Protocol = 'openai', path = '/v1/models///') {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const channel = { ...newChannel(protocol), baseUrl: 'https://harden.mock.invalid' + path, defaultModel: 'kept' };
  const vault = new CredentialVault(storage, storage); vault.set(channel.id, 'harden-secret'); return { channel, vault, snapshot: channelSnapshot(channel, vault) };
}
const body = (protocol: Protocol) => protocol === 'gemini' ? { models: [{ name: 'models/actual-model' }] } : { data: [{ id: 'actual-model' }] };

describe('最终加固的原实现失败复现', () => {
  it.each(['gemini', 'anthropic'] as const)('%s原生完整models不应重复拼接', async (protocol) => {
    const a = setup(protocol), transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body(protocol)));
    await new AiClient(transport).listModels(a.snapshot);
    expect(new URL(String(transport.mock.calls[0][0])).pathname).toBe('/v1/models'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('连续404后界面应保留原选择并显示最后端点和实际尝试数量', async () => {
    const a = setup('openai', '/v1'), cache = new ModelCatalog(new AiClient(async () => new Response('', { status: 404 })));
    await cache.load(a.channel, a.vault, 10);
    const state = cache.getSnapshot()[a.channel.id]; expect(state.status).toBe('error'); expect(a.channel.defaultModel).toBe('kept');
    expect(state.message).toContain('最后尝试'); expect(state.message).toContain('https://harden.mock.invalid/models'); expect(state.message).toContain('候选 2');
  });
  it('Ollama官方ListModelResponse结构应使用model标识，不使用展示名', async () => {
    const a = setup(); const data = { models: [{ model: 'qwen3:latest', name: '显示名称', modified_at: '2026-10-24T00:00:00Z', size: 100, digest: 'sha256:abc' }] };
    expect(await new AiClient(async () => Response.json(data)).listModels(a.snapshot)).toEqual(['qwen3:latest']);
  });
  it('无法证明语义的name/label-only对象应报格式错误而非成功空表', async () => {
    const a = setup(); await expect(new AiClient(async () => Response.json({ models: [{ name: '价格档位', label: '平台昵称' }] })).listModels(a.snapshot)).rejects.toMatchObject({ code: 'model_list_format' });
  });
});

describe('三协议根路径与完整Models URL边界', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s只规范列表，不修改配置或生成路径', async (protocol) => {
    for (const suffix of ['/custom/v1', '/custom/v1/', '/custom/v1/models', '/custom/v1/models///']) {
      const a = setup(protocol, suffix), original = structuredClone(a.channel);
      const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body(protocol)));
      await new AiClient(transport).listModels(a.snapshot);
      const url = new URL(String(transport.mock.calls[0][0])); expect(url.pathname).toBe('/custom/v1/models');
      expect(url.pathname).not.toContain('/models/models'); expect(a.channel).toEqual(original);
      if (protocol === 'anthropic') expect(url.searchParams.get('limit')).toBe('100');
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['gemini', 'anthropic'] as const)('%s完整Models地址依旧分页，不探测OpenAI候选', async (protocol) => {
    const a = setup(protocol, protocol === 'gemini' ? '/v1beta/models/' : '/v1/models/');
    const first = protocol === 'gemini' ? { ...body(protocol), nextPageToken: 'next' } : { ...body(protocol), has_more: true, last_id: 'actual-model' };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json(body(protocol)));
    expect(await new AiClient(transport).listModels(a.snapshot)).toEqual(['actual-model']);
    expect(transport).toHaveBeenCalledTimes(2); expect(transport.mock.calls.every((call) => !new URL(String(call[0])).pathname.endsWith('/models/models'))).toBe(true);
    expect(new URL(String(transport.mock.calls[1][0])).searchParams.get(protocol === 'gemini' ? 'pageToken' : 'after_id')).toBe(protocol === 'gemini' ? 'next' : 'actual-model');
  });
});

describe('非标准字段必须有可靠结构依据', () => {
  it('标准id优先，模型昵称/分组/展示名不冒充标识', async () => {
    const a = setup(), content = { models: [{ id: '真实 Model (A)+', model: 'ignored', name: '昵称', label: '价格档' }] };
    expect(await new AiClient(async () => Response.json(content)).listModels(a.snapshot)).toEqual(['真实 Model (A)+']);
  });
  it.each([{ data: [{ model: '未验证' }] }, { models: [{ model: '未验证', name: '分组' }] }, { data: [{ name: '展示名' }] }])('未证明字段语义的响应不伪装空表：%j', async (content) => {
    await expect(new AiClient(async () => Response.json(content)).listModels(setup().snapshot)).rejects.toMatchObject({ code: 'model_list_format' });
  });
  it('可信结构中的非法/凭证ID仍被过滤，不回退name', async () => {
    const entry = (model: string) => ({ model, name: '不能代替ID', modified_at: '2026-10-24T00:00:00Z', size: 1, digest: 'sha256:known' });
    expect(await new AiClient(async () => Response.json({ models: [entry('harden-secret'), entry('bad\nmodel'), entry('正常 (线路)+')] })).listModels(setup().snapshot)).toEqual(['正常 (线路)+']);
  });
});

describe('本次失败诊断与旧成功结果分离', () => {
  it.each([401, 403, 404, 405, 429, 500, 503])('HTTP %s记录真实最后端点、尝试数和状态', async (status) => {
    const a = setup('openai', '/v1'); let failure: ModelListFailureDiagnostics | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ error: 'harden-secret private-body' }, { status }));
    await expect(new AiClient(fetcher).listModels(a.snapshot, { onFailureDiagnostics: (value) => { failure = value; } })).rejects.toBeDefined();
    const attempts = status === 404 || status === 405 ? 2 : 1;
    expect(fetcher).toHaveBeenCalledTimes(attempts);
    expect(failure).toMatchObject({ endpoint: `https://harden.mock.invalid/${attempts === 2 ? 'models' : 'v1/models'}`, attemptedEndpoints: attempts, httpStatus: status, pagesRead: 0 });
    expect(JSON.stringify(failure)).not.toMatch(/harden-secret|private-body|Authorization/);
  });
  it.each(['format', 'json', 'network'] as const)('%s不借用旧HTTP状态或泄露原始异常', async (kind) => {
    let failure: ModelListFailureDiagnostics | undefined; const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === 'network') throw new TypeError('Failed to fetch harden-secret private-body');
      return kind === 'format' ? Response.json({ secret: 'harden-secret' }) : new Response('harden-secret not json');
    });
    await expect(new AiClient(fetcher).listModels(setup('openai', '/v1').snapshot, { onFailureDiagnostics: (value) => { failure = value; } })).rejects.toBeDefined();
    expect(failure).toMatchObject({ endpoint: 'https://harden.mock.invalid/models', attemptedEndpoints: 2, errorCode: kind === 'format' ? 'model_list_format' : kind === 'json' ? 'invalid_json' : 'network' });
    expect(failure?.httpStatus).toBe(kind === 'network' ? undefined : 200); expect(JSON.stringify(failure)).not.toMatch(/harden-secret|private-body/);
  });
  it.each(['http', 'network'] as const)('第二页%s失败报告本次分页，不能把第一页当完整成功', async (kind) => {
    const a = setup('openai', '/v1'); let failure: ModelListFailureDiagnostics | undefined;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: 'a' }], next_cursor: 'private-cursor' })).mockImplementation(async () => {
      if (kind === 'network') throw new TypeError('not available'); return new Response('', { status: 503 });
    });
    const success = vi.fn(); await expect(new AiClient(fetcher).listModels(a.snapshot, { onDiagnostics: success, onFailureDiagnostics: (value) => { failure = value; } })).rejects.toBeDefined();
    expect(success).not.toHaveBeenCalled(); expect(failure).toMatchObject({ endpoint: 'https://harden.mock.invalid/v1/models', attemptedEndpoints: 1, pagesRead: 1 });
    expect(failure?.httpStatus).toBe(kind === 'network' ? undefined : 503); expect(JSON.stringify(failure)).not.toContain('private-cursor');
  });
  it.each(['cancel', 'timeout'] as const)('%s覆盖整次请求，迟到响应不能改写失败诊断', async (kind) => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>((resolve) => { release = resolve; }));
    const controller = new AbortController(), failure = vi.fn(), success = vi.fn();
    const pending = new AiClient(fetcher).listModels(setup('openai', '/v1').snapshot, { signal: controller.signal, timeoutSeconds: kind === 'timeout' ? 0.01 : 10, onFailureDiagnostics: failure, onDiagnostics: success });
    const assertion = expect(pending).rejects.toMatchObject({ code: kind === 'timeout' ? 'timeout' : 'cancelled' }); if (kind === 'cancel') controller.abort(); await assertion;
    expect(failure).toHaveBeenCalledTimes(1); const before = JSON.stringify(failure.mock.calls);
    expect(failure.mock.calls[0][0]).toMatchObject({ endpoint: 'https://harden.mock.invalid/v1/models', attemptedEndpoints: 1 }); expect(failure.mock.calls[0][0].httpStatus).toBeUndefined();
    release(Response.json(body('openai'))); await new Promise((resolve) => setTimeout(resolve, 0)); expect(JSON.stringify(failure.mock.calls)).toBe(before); expect(success).not.toHaveBeenCalled();
  });
  it('请求前取消准确记录零次尝试，不制造HTTP状态', async () => {
    const controller = new AbortController(); controller.abort(); const failure = vi.fn(), fetcher = vi.fn<typeof fetch>();
    await expect(new AiClient(fetcher).listModels(setup().snapshot, { signal: controller.signal, onFailureDiagnostics: failure })).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled(); expect(failure.mock.calls[0][0]).toMatchObject({ attemptedEndpoints: 0, pagesRead: 0 }); expect(failure.mock.calls[0][0].endpoint).toBeUndefined(); expect(failure.mock.calls[0][0].httpStatus).toBeUndefined();
  });
  it('刷新失败保留上次成功数量，另存本次失败说明', async () => {
    const a = setup('openai', '/v1'); let fail = false;
    const cache = new ModelCatalog(new AiClient(async () => fail ? new Response('', { status: 404 }) : Response.json(body('openai'))));
    await cache.load(a.channel, a.vault, 10); const previous = cache.getSnapshot()[a.channel.id]; fail = true; await cache.load(a.channel, a.vault, 10, true);
    const current = cache.getSnapshot()[a.channel.id]; expect(current.diagnostics).toEqual(previous.diagnostics); expect(current.models).toEqual(previous.models);
    expect(current.failureDiagnostics).toMatchObject({ httpStatus: 404, attemptedEndpoints: 2 }); expect(current.message).toContain('非本次请求结果'); expect(a.vault.get(a.channel.id)).toBe('harden-secret');
  });
  it.each(['a%2bb', 'a%252Bb', 'a%25252bb'])('路径编码%s中的已知凭证也脱敏，删除所有查询', (part) => {
    const value = safeModelListEndpoint(`https://harden.mock.invalid/${part}/models?cursor=private&api_key=a%2Bb`, 'a+b');
    expect(value).toContain('[密钥已隐藏]'); expect(value).not.toMatch(/cursor|private|api_key|a%|a\+b/);
  });
  it('显式token路径和编码Bearer内容不会成为诊断明文', () => {
    expect(safeModelListEndpoint('https://harden.mock.invalid/token/private-value/models', 'unused')).not.toContain('private-value');
    expect(safeModelListEndpoint('https://harden.mock.invalid/Bearer%20private-value/models', 'unused')).not.toContain('private-value');
  });
});

it('失败诊断观察器异常不掩盖原始授权错误、不追加请求', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 401 }));
  await expect(new AiClient(fetcher).listModels(setup().snapshot, { onFailureDiagnostics: () => { throw new Error('observer-failure'); } })).rejects.toMatchObject({ code: 'authorization', status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('鉴权快照缺失时不能把未发出的GET计为一次尝试', async () => {
  const snapshot = { ...setup().snapshot }, failure = vi.fn(), fetcher = vi.fn<typeof fetch>();
  await expect(new AiClient(fetcher).listModels(snapshot, { onFailureDiagnostics: failure })).rejects.toMatchObject({ code: 'credentials' });
  expect(fetcher).not.toHaveBeenCalled(); expect(failure.mock.calls[0][0].attemptedEndpoints).toBe(0); expect(failure.mock.calls[0][0].endpoint).toBeUndefined();
});

it('模型标识经列表、保存恢复、四阶段路由和真实wire请求原样传递，不发送展示名', async () => {
  const a = setup('openai', '/v1'), storageData = new Map<string, string>();
  const storage = { getItem: (key: string) => storageData.get(key) ?? null, setItem: (key: string, value: string) => { storageData.set(key, value); } };
  for (const id of ['qwen3:latest', '原样 Model (A)+']) {
    const response = id === 'qwen3:latest' ? { models: [{ model: id, name: '展示名称', modified_at: '2026-10-24T00:00:00Z', size: 1, digest: 'sha256:known' }] } : { data: [{ id, display_name: '展示名称' }] };
    const models = await new AiClient(async () => Response.json(response)).listModels(a.snapshot);
    const config = defaultAiConfig(); config.channels = [{ ...a.channel, defaultModel: models[0] }]; config.routes.story = { channelId: a.channel.id, modelId: '' };
    for (const stage of ['variables', 'world', 'memory'] as const) config.routes[stage] = { mode: 'independent', channelId: a.channel.id, modelId: models[0] };
    saveAiConfig(storage, config); const restored = readAiConfig(storage);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://harden.mock.invalid/v1/chat/completions'); expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body)).model).toBe(id); expect(String(init?.body)).not.toContain('展示名称');
      return Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });
    });
    for (const stage of ['story', 'variables', 'world', 'memory'] as const) await new AiClient(fetcher).generate(requestSnapshot(restored, stage, a.vault), [{ role: 'user', content: 'Mock protocol check' }]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  }
});

it('原生Gemini标准v1beta根路径保持正确，不强制改成v1', async () => {
  const a = setup('gemini', '/v1beta/'), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(body('gemini')));
  await new AiClient(fetcher).listModels(a.snapshot);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://harden.mock.invalid/v1beta/models'); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('Fetch错误Response的status=0不能冒充HTTP状态码', async () => {
  const failure = vi.fn();
  await expect(new AiClient(async () => Response.error()).listModels(setup('openai', '/v1').snapshot, { onFailureDiagnostics: failure })).rejects.toMatchObject({ code: 'network' });
  expect(failure.mock.calls[0][0].httpStatus).toBeUndefined(); expect(failure.mock.calls[0][0].attemptedEndpoints).toBe(2);
});

describe('最终审查：编码分隔符和不同候选错误', () => {
  it.each(['token%2Fprivate-value', 'api_key%3Dprivate-value', 'token%252Fprivate-value',
    'token%25252Fprivate-value', 'api_key%25253Dprivate-value', 'token%2F/private-value',
    'token/private-value', 'token%25252525252Fprivate-value'])('未知路径令牌%s不进入诊断', (path) => {
    const result = safeModelListEndpoint(`https://harden.mock.invalid/${path}/models`, 'different-configured-key');
    expect(result).not.toContain('private-value'); expect(result).toContain('[敏感路径已隐藏]');
  });
  it('编码结构不明确时保守遮蔽，正常自定义路径仍可读', () => {
    expect(safeModelListEndpoint('https://harden.mock.invalid/%ZZprivate-value/models', 'unused')).not.toContain('private-value');
    expect(safeModelListEndpoint('https://harden.mock.invalid/custom/%E4%B8%AD%E6%96%87/v1/models', 'unused'))
      .toBe('https://harden.mock.invalid/custom/%E4%B8%AD%E6%96%87/v1/models');
  });
  it.each(['configured-key', '%63onfigured-key', '%2563onfigured-key'])('已知凭证%s仍隐藏', (key) => {
    expect(safeModelListEndpoint(`https://harden.mock.invalid/${key}/models`, 'configured-key')).not.toContain(key);
    expect(safeModelListEndpoint(`https://harden.mock.invalid/${key}/models`, 'configured-key')).toContain('[密钥已隐藏]');
  });
  it.each(['success', 'failure'] as const)('仅%s诊断脱敏，不改变真实URL、请求数或鉴权', async (outcome) => {
    const a = setup('gemini', '/token%2Fprivate-value'), before = structuredClone(a.channel), success = vi.fn(), failure = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => outcome === 'success' ? Response.json(body('gemini')) : new Response('', { status: 401 }));
    const pending = new AiClient(fetcher).listModels(a.snapshot, { onDiagnostics: success, onFailureDiagnostics: failure });
    if (outcome === 'success') await expect(pending).resolves.toEqual(['actual-model']); else await expect(pending).rejects.toMatchObject({ code: 'authorization', status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toBe('https://harden.mock.invalid/token%2Fprivate-value/models');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-goog-api-key')).toBe('harden-secret');
    expect(JSON.stringify([success.mock.calls, failure.mock.calls])).not.toContain('private-value'); expect(a.channel).toEqual(before);
  });
  it.each(['405', 'format'] as const)('%s→404：保留前因但明确分离最后端点状态和旧列表', async (first) => {
    const a = setup('openai', '/v1'), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body('openai')));
    const catalog = new ModelCatalog(new AiClient(fetcher)); await catalog.load(a.channel, a.vault, 10);
    const previous = catalog.getSnapshot()[a.channel.id];
    fetcher.mockResolvedValueOnce(first === '405' ? new Response('', { status: 405 }) : Response.json({ unsupported: true }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    await catalog.load(a.channel, a.vault, 10, true); const state = catalog.getSnapshot()[a.channel.id];
    expect(fetcher).toHaveBeenCalledTimes(3); expect(state.models).toEqual(previous.models); expect(state.diagnostics).toEqual(previous.diagnostics);
    expect(state.failureDiagnostics).toMatchObject({ endpoint: 'https://harden.mock.invalid/models', attemptedEndpoints: 2, httpStatus: 404,
      errorCode: first === '405' ? 'rejected' : 'model_list_format' });
    expect(state.message).toContain('保留的错误（可能来自此前候选）'); expect(state.message).toContain(first === '405' ? '（405）' : '模型列表返回格式不受支持');
    expect(state.message).toContain('最后端点状态：HTTP 404'); expect(state.message).not.toContain('最后端点状态：HTTP 405');
    expect(state.message).toContain('非本次请求结果'); expect(a.channel.defaultModel).toBe('kept'); expect(a.vault.get(a.channel.id)).toBe('harden-secret');
  });
  it('第二页网络失败显示未知的最后状态，不误称此前候选HTTP错误', async () => {
    const a = setup('openai', '/v1'), fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'a' }], next_cursor: 'private-cursor' }))
      .mockRejectedValueOnce(new TypeError('private-server-error'));
    const catalog = new ModelCatalog(new AiClient(fetcher)); await catalog.load(a.channel, a.vault, 10);
    const state = catalog.getSnapshot()[a.channel.id];
    expect(state.failureDiagnostics).toMatchObject({ attemptedEndpoints: 1, pagesRead: 1, errorCode: 'network' });
    expect(state.failureDiagnostics?.httpStatus).toBeUndefined(); expect(state.message).toContain('最后端点状态：未获得 HTTP 状态');
    expect(state.message).not.toMatch(/HTTP 200|此前候选|private-cursor|private-server-error/); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
