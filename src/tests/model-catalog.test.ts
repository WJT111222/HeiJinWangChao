import { describe, expect, it, vi } from 'vitest';
import { AiClient } from '../services/ai/client';
import { newChannel } from '../services/ai/configuration';
import type { Protocol } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { ModelCatalog } from '../ui/settings/modelCatalog';

function setup(protocol: Protocol = 'openai') {
  const data = new Map<string, string>(), storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  const vault = new CredentialVault(storage, storage), channel = newChannel(protocol);
  channel.baseUrl = 'https://models.mock.invalid/v1'; vault.set(channel.id, 'catalog-mock-key');
  return { channel, vault };
}
const json = (protocol: Protocol = 'openai', ids = ['model-a', 'model-b']) => Response.json(protocol === 'gemini'
  ? { models: ids.map((id) => ({ name: `models/${id}` })) } : { data: ids.map((id) => ({ id })) });

describe('设置页共享模型列表：复用真实客户端、不生成内容', () => {
  it.each(['openai', 'gemini', 'anthropic'] as const)('%s协议无需默认模型即可按原认证获取模型列表', async (protocol) => {
    const { channel, vault } = setup(protocol);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(protocol)), cache = new ModelCatalog(new AiClient(fetcher));
    await cache.load(channel, vault, 10);
    expect(cache.getSnapshot()[channel.id]).toMatchObject({ status: 'ready', models: ['model-a', 'model-b'] });
    expect(fetcher).toHaveBeenCalledTimes(1); expect((fetcher.mock.calls[0][1]?.method ?? 'GET')).toBe('GET');
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get(protocol === 'openai' ? 'authorization' : protocol === 'gemini' ? 'x-goog-api-key' : 'x-api-key')).toContain('catalog-mock-key');
    expect(JSON.stringify(cache.getSnapshot())).not.toContain('catalog-mock-key');
  });
  it('四阶段同时请求同一渠道只发一次，结果复用直到手动刷新', async () => {
    const { channel, vault } = setup(), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json()), cache = new ModelCatalog(new AiClient(fetcher));
    await Promise.all(Array.from({ length: 4 }, () => cache.load(channel, vault, 10)));
    expect(fetcher).toHaveBeenCalledTimes(1); await cache.load(channel, vault, 10); expect(fetcher).toHaveBeenCalledTimes(1);
    await cache.load(channel, vault, 10, true); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('不同渠道不混用模型列表', async () => {
    const { channel, vault } = setup(), other = { ...channel, id: 'second-channel', baseUrl: 'https://other.mock.invalid/v1' };
    vault.set(other.id, 'second-key'); const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json('openai', ['first'])).mockResolvedValueOnce(json('openai', ['second']));
    const cache = new ModelCatalog(new AiClient(fetcher)); await cache.load(channel, vault, 10); await cache.load(other, vault, 10);
    expect(cache.getSnapshot()[channel.id].models).toEqual(['first']); expect(cache.getSnapshot()[other.id].models).toEqual(['second']);
  });
  it('刷新失败保留已有列表及配置/凭证，失败不会自动重试', async () => {
    const { channel, vault } = setup(), original = structuredClone(channel);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json()).mockResolvedValueOnce(Response.json({ error: 'catalog-mock-key' }, { status: 401 }));
    const cache = new ModelCatalog(new AiClient(fetcher)); await cache.load(channel, vault, 10); await cache.load(channel, vault, 10, true);
    expect(cache.getSnapshot()[channel.id]).toMatchObject({ status: 'error', models: ['model-a', 'model-b'] });
    expect(JSON.stringify(cache.getSnapshot())).not.toContain('catalog-mock-key');
    await cache.load(channel, vault, 10); expect(fetcher).toHaveBeenCalledTimes(2); expect(channel).toEqual(original); expect(vault.get(channel.id)).toBe('catalog-mock-key');
  });
  it('空列表不伪造默认模型，手动刷新可以恢复', async () => {
    const { channel, vault } = setup(), fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json('openai', [])).mockResolvedValueOnce(json());
    const cache = new ModelCatalog(new AiClient(fetcher)); await cache.load(channel, vault, 10);
    expect(cache.getSnapshot()[channel.id]).toMatchObject({ status: 'empty', models: [] }); expect(channel.defaultModel).toBe('');
    await cache.load(channel, vault, 10, true); expect(cache.getSnapshot()[channel.id].status).toBe('ready');
  });
  it('地址/协议或凭证改变后失效旧缓存；默认模型和参数改变不重复查询', async () => {
    const { channel, vault } = setup(), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json()), cache = new ModelCatalog(new AiClient(fetcher));
    await cache.load(channel, vault, 10); await cache.load({ ...channel, defaultModel: 'different-model', parameters: {} }, vault, 10);
    expect(fetcher).toHaveBeenCalledTimes(1); vault.set(channel.id, 'rotated-key'); await cache.load(channel, vault, 10);
    expect(fetcher).toHaveBeenCalledTimes(2); await cache.load({ ...channel, baseUrl: 'https://changed.mock.invalid/v1' }, vault, 10);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('配置变化时旧地址迟到结果不能覆盖新列表', async () => {
    const { channel, vault } = setup(); let release!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Promise<Response>((resolve) => { release = resolve; })).mockResolvedValue(json('openai', ['new-model']));
    const cache = new ModelCatalog(new AiClient(fetcher)); const old = cache.load(channel, vault, 10);
    await cache.load({ ...channel, baseUrl: 'https://changed.mock.invalid/v1' }, vault, 10); release(json('openai', ['old-model'])); await old;
    expect(cache.getSnapshot()[channel.id].models).toEqual(['new-model']);
  });
  it('删除渠道和离开设置均终止请求，迟到结果不重新出现', async () => {
    for (const dispose of [false, true]) {
      const { channel, vault } = setup(); let release!: (value: Response) => void;
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Promise<Response>((resolve) => { release = resolve; }));
      const cache = new ModelCatalog(new AiClient(fetcher)), pending = cache.load(channel, vault, 10);
      if (dispose) cache.dispose(); else cache.remove(channel.id); release(json()); await pending;
      expect(cache.getSnapshot()[channel.id]?.status).not.toBe('ready');
    }
  });
  it('未提供凭证时不请求网络、不暴露供应商正文', async () => {
    const { channel, vault } = setup(); vault.delete(channel.id);
    const fetcher = vi.fn<typeof fetch>(), cache = new ModelCatalog(new AiClient(fetcher)); await cache.load(channel, vault, 10);
    expect(fetcher).not.toHaveBeenCalled(); expect(cache.getSnapshot()[channel.id].status).toBe('error');
  });
});

describe('列表数量和分页诊断', () => {
  it('20页仍有后续时明确告知部分列表，不冒充完整平台模型', async () => {
    const { channel, vault } = setup(); let number = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => { number++; return Response.json({ data: [{ id: `model-${number}` }], next_cursor: `page-${number}` }); });
    const cache = new ModelCatalog(new AiClient(transport)); await cache.load(channel, vault, 10);
    expect(cache.getSnapshot()[channel.id]).toMatchObject({ status: 'ready', diagnostics: { pages: 20, complete: false, uniqueModels: 20 } });
    expect(cache.getSnapshot()[channel.id].message).toContain('20页读取上限'); expect(cache.getSnapshot()[channel.id].message).toContain('可能不是该平台全部可用模型'); expect(transport).toHaveBeenCalledTimes(20);
  });
  it('失败刷新保留上次成功列表的数量诊断，当前错误不冒充新结果', async () => {
    const { channel, vault } = setup(); let fail = false;
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => fail ? new Response('', { status: 404 }) : json());
    const cache = new ModelCatalog(new AiClient(transport)); await cache.load(channel, vault, 10);
    const previous = cache.getSnapshot()[channel.id]; fail = true; await cache.load(channel, vault, 10, true);
    expect(cache.getSnapshot()[channel.id]).toMatchObject({ status: 'error', models: previous.models, diagnostics: previous.diagnostics });
    expect(cache.getSnapshot()[channel.id].message).toContain('模型列表接口不存在'); expect(vault.get(channel.id)).toBe('catalog-mock-key');
  });
});
