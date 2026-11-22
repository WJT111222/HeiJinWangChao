import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { modelListCandidates } from '../services/ai/modelListing';
import type { ModelListDiagnostics } from '../services/ai/modelListing';
import { AiConfigSchema, defaultAiConfig, modelIdSchema, readAiConfig, saveAiConfig, newChannel } from '../services/ai/configuration';
import type { AiTask, Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { channelSnapshot } from '../services/ai/snapshot';

function setup(baseUrl = 'https://list.mock.invalid/v1', protocol: Protocol = 'openai', stage: AiTask = 'story', model = '') {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const channel = { ...newChannel(protocol), baseUrl }, vault = new CredentialVault(storage, storage);
  vault.set(channel.id, 'list-mock-secret'); return channelSnapshot(channel, vault, model, stage);
}
const list = (ids = ['model-a']) => Response.json({ data: ids.map((id) => ({ id })) });

describe('模型列表兼容缺口复现', () => {
  it('标准路径404后在同源/v1/models找到列表', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url) === 'https://list.mock.invalid/v1/models' ? list() : new Response('', { status: 404 }));
    expect(await new AiClient(transport).listModels(setup('https://list.mock.invalid'))).toEqual(['model-a']);
    expect(transport.mock.calls.map((call) => String(call[0]))).toEqual(['https://list.mock.invalid/models', 'https://list.mock.invalid/v1/models']);
  });
  it('误填聊天完整地址和多个末尾斜杠，只为列表校正地址', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url) === 'https://list.mock.invalid/v2/models' ? list() : new Response('', { status: 404 }));
    expect(await new AiClient(transport).listModels(setup('https://list.mock.invalid/v2/chat/completions///'))).toEqual(['model-a']);
    expect(transport.mock.calls).toHaveLength(1);
  });
  it('未知JSON结构不能冒充成功空列表', async () => {
    await expect(new AiClient(async () => Response.json({ account: 'sensitive', message: 'wrong endpoint' })).listModels(setup())).rejects.toBeDefined();
  });
  it('服务器真实返回的中文、括号和空格模型ID可以选择并保存', async () => {
    const ids = ['厂商/模型+1 (线路A)', 'model-a'];
    expect(await new AiClient(async () => list(ids)).listModels(setup())).toEqual([...ids].sort());
  });
  it('OpenAI明确cursor分页不能静默遗漏第二页', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'b' }], has_more: false }));
    expect(await new AiClient(transport).listModels(setup())).toEqual(['a', 'b']);
    expect(String(transport.mock.calls[1][0])).toBe('https://list.mock.invalid/v1/models?after=a');
  });
});

describe('同源有界端点兼容、错误与生成路径保护', () => {
  it.each([
    ['https://list.mock.invalid/', ['/models', '/v1/models']],
    ['https://list.mock.invalid/v1///', ['/v1/models', '/models']],
    ['https://list.mock.invalid/proxy/v2/chat/completions/', ['/proxy/v2/models', '/proxy/models', '/models', '/v1/models']],
    ['https://list.mock.invalid/proxy', ['/proxy/models', '/proxy/v1/models', '/models', '/v1/models']],
    ['https://list.mock.invalid/openai/v1beta2/coding', ['/openai/v1beta2/coding/models', '/openai/models', '/models', '/v1/models']],
  ])('%s只构造少量明确同源Models路径', (base, paths) => {
    const urls = modelListCandidates(setup(base)); expect(urls.map((url) => new URL(url).pathname)).toEqual(paths);
    expect(new Set(urls).size).toBe(urls.length); expect(urls.length).toBeLessThanOrEqual(4);
    for (const url of urls) { expect(new URL(url).origin).toBe(new URL(base).origin); expect(new URL(url).search).toBe(''); expect(url).not.toMatch(/admin|dashboard|relay\?/); }
  });
  it.each(['gemini', 'anthropic'] as const)('%s只使用原生列表端点，不套OpenAI候选', async (protocol) => {
    const snapshot = setup('https://list.mock.invalid/v1/', protocol), fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    expect(modelListCandidates(snapshot)).toHaveLength(1); await expect(new AiClient(fetcher).listModels(snapshot)).rejects.toMatchObject({ code: 'not_found' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('标准成功立即停止；成功的空列表也不继续探测', async () => {
    for (const ids of [['only-server-model'], []]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => list(ids));
      expect(await new AiClient(fetcher).listModels(setup())).toEqual(ids); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each([401, 403, 429, 500, 503])('%s不作为路径故障继续探测，不暴露服务正文', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'list-mock-secret private account details' }, { status }));
    const pending = new AiClient(fetcher).listModels(setup());
    await expect(pending).rejects.toMatchObject({ code: status < 404 ? 'authorization' : status === 429 ? 'rate_limit' : 'server' });
    expect(fetcher).toHaveBeenCalledTimes(1); await expect(pending).rejects.not.toThrow(/list-mock-secret|private account/);
  });
  it.each([404, 405, 'format', 'json', 'network'] as const)('%s只在同源候选间有限回退', async (failure) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch list-mock-secret');
      if (failure === 'format') return Response.json({ not_models: [] });
      if (failure === 'json') return new Response('<html>login</html>');
      return new Response('', { status: failure });
    }).mockImplementation(async () => list());
    expect(await new AiClient(fetcher).listModels(setup())).toEqual(['model-a']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://list.mock.invalid'); expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('omit'); expect(String(url)).not.toContain('list-mock-secret');
    }
  });
  it('所有候选都失败时保留准确的格式错误而非被404掩盖', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ secret: 'list-mock-secret' })).mockImplementation(async () => new Response('', { status: 404 }));
    await expect(new AiClient(fetcher).listModels(setup())).rejects.toMatchObject({ code: 'model_list_format' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('不跟随模型列表重定向到第三方，也不做生成请求', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.redirect('https://third-party.mock.invalid/admin', 302));
    await expect(new AiClient(fetcher).listModels(setup())).rejects.toBeDefined(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error'); expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
  });
  it('取消发生在候选之间时停止，不启动第二个路径', async () => {
    const controller = new AbortController(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { controller.abort(); return new Response('', { status: 404 }); });
    await expect(new AiClient(fetcher).listModels(setup(), { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('超时不会自动切换候选重发', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>(() => {}));
    await expect(new AiClient(fetcher).listModels(setup(), { timeoutSeconds: 0.01 })).rejects.toMatchObject({ code: 'timeout' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('完整聊天地址在各阶段均只使用一次', async () => {
    const snapshot = setup('https://list.mock.invalid/v1/chat/completions/');
    const { wireRequest } = await import('../services/ai/protocols');
    const { channel } = snapshot;
    for (const stage of ['story', 'variables', 'world', 'memory'] as const) {
      // 模型只影响JSON/编码，不更改原有endpoint函数。
      const wire = wireRequest(setup(channel.baseUrl, 'openai', stage, '模型 (A)+'), [{ role: 'user', content: '测试' }], false);
      expect(wire.url).toBe('https://list.mock.invalid/v1/chat/completions');
      expect(JSON.parse(wire.init.body).model).toBe('模型 (A)+');
    }
  });
});

describe('解析、真实数量与不伪造模型', () => {
  it.each([
    { data: [{ id: 'a' }, { id: 'b' }] }, { models: ['a', 'b'] }, ['a', { id: 'b' }],
  ])('接受明确数组形态 %j', async (value) => {
    expect(await new AiClient(async () => Response.json(value)).listModels(setup())).toEqual(['a', 'b']);
  });
  it('原始/有效/过滤/重复/显示数量可核对，凭证条目不进入诊断', async () => {
    const raw = [{ id: ' a ' }, { id: 'a' }, { id: '厂商/模型 (A)+' }, { id: 'bad\nmodel' }, { id: 42 }, { display_name: 'not-an-id' }, { id: 'list-mock-secret' }];
    let stats: ModelListDiagnostics | undefined;
    const ids = await new AiClient(async () => Response.json({ data: raw })).listModels(setup(), { onDiagnostics: (value) => { stats = value; } });
    expect(ids).toEqual(['a', '厂商/模型 (A)+']); expect(stats).toEqual({ rawEntries: 7, validEntries: 3, filteredEntries: 4, duplicateEntries: 1, uniqueModels: 2, pages: 1, attemptedEndpoints: 1, complete: true, fullEndpointInput: false, endpoint: 'https://list.mock.invalid/v1/models', httpStatus: 200 });
    expect(JSON.stringify(stats)).not.toContain('list-mock-secret');
  });
  it('旧配置无迁移，新Unicode ID可以原样保存恢复，控制和不可见字符仍拒绝', () => {
    const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const config = defaultAiConfig(); config.channels = [{ ...newChannel(), defaultModel: '厂商/模型+1 (线路A)' }];
    saveAiConfig(storage, config); expect(readAiConfig(storage)).toEqual(config); expect(AiConfigSchema.parse(config).version).toBe(1);
    for (const value of ['old-model', 'o1@2026:fast', '模型 [高速]', 'a'.repeat(200)]) expect(modelIdSchema.safeParse(value).success).toBe(true);
    for (const value of ['', ' bad', 'bad ', 'bad\nmodel', 'bad\u200bmodel', '\ud800', 'a'.repeat(201)]) expect(modelIdSchema.safeParse(value).success).toBe(false);
  });
  it('空数组与所有条目无效均是成功空列表，包含真实过滤数量', async () => {
    for (const entries of [[], [{ id: 1 }, { name: '不能猜成ID' }]]) {
      let stats: ModelListDiagnostics | undefined;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: entries }));
      expect(await new AiClient(fetcher).listModels(setup(), { onDiagnostics: (value) => { stats = value; } })).toEqual([]);
      expect(stats?.filteredEntries).toBe(entries.length); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

describe('只跟随受支持的分页游标，保持同一路径和上限', () => {
  it.each([
    ['openai', { next_cursor: 'abc+/=' }, 'cursor', 'abc+/='],
    ['openai', { next_page: 2 }, 'page', '2'],
    ['gemini', { nextPageToken: 'gem-token' }, 'pageToken', 'gem-token'],
    ['anthropic', { has_more: true, last_id: 'last-model' }, 'after_id', 'last-model'],
  ] as const)('%s %j读取第二页且不切换端点', async (protocol, meta, query, value) => {
    const body = (id: string, metadata: object) => protocol === 'gemini' ? { models: [{ name: 'models/' + id }], ...metadata } : { data: [{ id }], ...metadata };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(body('a', meta))).mockResolvedValueOnce(Response.json(body('b', {})));
    expect(await new AiClient(fetcher).listModels(setup(undefined, protocol))).toEqual(['a', 'b']);
    const next = new URL(String(fetcher.mock.calls[1][0])); expect(next.pathname).toBe('/v1/models'); expect(next.searchParams.get(query)).toBe(value);
    if (protocol === 'anthropic') expect(next.searchParams.get('limit')).toBe('100');
  });
  it.each([
    { has_more: true }, { has_more: true, last_id: '' }, { has_more: 'yes' }, { next_cursor: 'list-mock-secret' },
    { next: 'https://evil.mock.invalid/admin' }, { links: { next: 'http://127.0.0.1/private' } },
    { next_page: -1 }, { next_page: '2' }, { next_cursor: 'a', next_page: 2 }, { has_more: false, next_cursor: 'a' },
  ])('异常/不支持的分页不伪装完整结果：%j', async (metadata) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ id: 'a' }], ...metadata }));
    await expect(new AiClient(fetcher).listModels(setup())).rejects.toMatchObject({ code: 'model_list_pagination' }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('分页循环拒绝，不再开始候选探测', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ id: 'a' }], next_cursor: 'same-token' }));
    await expect(new AiClient(fetcher).listModels(setup())).rejects.toMatchObject({ code: 'model_list_pagination' }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('第二页HTTP失败不回退另一端点，也不报告完整列表', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [{ id: 'a' }], next_cursor: 'next' })).mockResolvedValueOnce(new Response('', { status: 404 }));
    const diagnostics = vi.fn(); await expect(new AiClient(fetcher).listModels(setup(), { onDiagnostics: diagnostics })).rejects.toMatchObject({ code: 'not_found' });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(diagnostics).not.toHaveBeenCalled();
  });
  it('最多20页，返回真实部分列表并明确标记未读完，不无限请求', async () => {
    let number = 0, stats: ModelListDiagnostics | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => { number++; return Response.json({ data: [{ id: `model-${number}` }], next_cursor: `cursor-${number}` }); });
    const result = await new AiClient(fetcher).listModels(setup(), { onDiagnostics: (value) => { stats = value; } });
    expect(result).toHaveLength(20); expect(fetcher).toHaveBeenCalledTimes(20); expect(stats).toMatchObject({ pages: 20, complete: false, uniqueModels: 20 });
  });
});

describe('最新main任务书的完整Models路径及脱敏端点', () => {
  it.each(['https://list.mock.invalid/v1/models/', 'https://list.mock.invalid/models///', 'https://list.mock.invalid/custom/v2/Models'])('%s优先使用完整模型路径，不追加第二个models', async (base) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => list()); let diagnostics: ModelListDiagnostics | undefined;
    await new AiClient(fetcher).listModels(setup(base), { onDiagnostics: (value) => { diagnostics = value; } });
    expect(String(fetcher.mock.calls[0][0])).toBe(base.replace(/\/+$/, '')); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(diagnostics).toMatchObject({ fullEndpointInput: true, endpoint: base.replace(/\/+$/, ''), httpStatus: 200 });
  });
  it('诊断只记录真实选中的同源列表端点，不包含分页查询或认证头', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: 'a' }], next_cursor: 'private-cursor' }))
      .mockResolvedValueOnce(list(['b']));
    let diagnostics: ModelListDiagnostics | undefined;
    await new AiClient(fetcher).listModels(setup('https://list.mock.invalid'), { onDiagnostics: (value) => { diagnostics = value; } });
    expect(diagnostics).toMatchObject({ endpoint: 'https://list.mock.invalid/v1/models', attemptedEndpoints: 2, httpStatus: 200, pages: 2 });
    expect(JSON.stringify(diagnostics)).not.toMatch(/private-cursor|list-mock-secret|Authorization|\?/);
  });
  it('诊断中的已编码凭证路径也会脱敏', async () => {
    const channel = { ...newChannel(), baseUrl: 'https://list.mock.invalid/a%2Bb/v1' };
    const storage = { getItem: () => 'a+b', setItem: () => {}, removeItem: () => {} }, vault = new CredentialVault(storage, storage);
    let diagnostics: ModelListDiagnostics | undefined;
    await new AiClient(async () => list()).listModels(channelSnapshot(channel, vault), { onDiagnostics: (value) => { diagnostics = value; } });
    expect(diagnostics?.endpoint).not.toContain('a%2Bb'); expect(diagnostics?.endpoint).not.toContain('a+b');
    expect(diagnostics?.endpoint).toContain('[密钥已隐藏]');
  });
});

const compatibleRoutes = [
  ['https://qianfan.baidubce.com/v2', 'ernie-test'],
  ['https://ark.cn-beijing.volces.com/api/v3', 'ep-synthetic'],
  ['https://ark.cn-beijing.volces.com/api/plan/v3', 'ark-code-latest'],
  ['https://openrouter.ai/api/v1', 'vendor/model-1:free'],
] as const;

describe.each(compatibleRoutes)('渠道正式 HTTP 边界 %s', (base, model) => {
  it.each(['story', 'variables', 'world', 'memory'] as const)('%s 保留完整 ID、版本前缀和一次 POST', async stage => {
    for (const suffix of ['', '/chat/completions/', '/models///']) {
      for (const stream of [false, true]) {
        const snapshot = setup(base + suffix, 'openai', stage, model);
        const transport = vi.fn<typeof fetch>(async () => stream
          ? new Response('data: {"choices":[{"delta":{"content":"收到"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}})
          : Response.json({choices:[{message:{content:'收到'},finish_reason:'stop'}]}));
        const result = await new AiClient(transport).generate(snapshot,[{role:'user',content:'合成测试'}],{stream});
        expect(result.text).toBe('收到');
        expect(transport).toHaveBeenCalledTimes(1);
        const [url, init] = transport.mock.calls[0];
        expect(url).toBe(base + '/chat/completions');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer list-mock-secret');
        expect(JSON.parse(String(init?.body))).toMatchObject({model,stream});
        expect(snapshot.channel.baseUrl).toBe(base + suffix);
      }
    }
  });
  it('已知入口的列表仅在当前产品路径读取', async () => {
    const transport = vi.fn<typeof fetch>(async () => new Response(null,{status:405}));
    await expect(new AiClient(transport).listModels(setup(base))).rejects.toMatchObject({status:405});
    expect(transport.mock.calls.map(([url])=>url)).toEqual([base + '/models']);
  });
});

it.each([
  [404,'model_not_found','model','not_found','channel.model'],
  [400,'unsupported_parameter','stream','rejected','channel.parameter'],
  [404,'unclassified','','not_found',undefined],
] as const)('生成 HTTP %i %s 保留可确认的归因，且不泄露响应原文', async (status,code,param,errorCode,fieldPath) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({error:{code,param,message:'list-mock-secret 私人原文'}},{status}));
  const error = await new AiClient(fetcher).generate(setup(compatibleRoutes[0][0],'openai','variables','test-model'),[{role:'user',content:'测试'}]).catch(e=>e);
  expect(error.code).toBe(errorCode);
  expect(error.details?.fieldPath).toBe(fieldPath);
  expect(error.message).not.toMatch(/list-mock-secret|私人原文/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
