import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { deflateRawSync } from 'node:zlib';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { buildRequest, convertText, generateImage, probe } from '../services/images/protocol';
import { defaults, credentialId, imageVault } from '../services/images/config';
import { targetFor, validTarget } from '../services/images/model';
import { decode, rasterMime, unpack } from '../services/images/raster';
import { 归一化单段词组转化器输出 } from '../services/images/promptTokens';
import type { Job } from '../services/images/library';
import { game, npc, story } from './fixtures/game';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJUlEQVR4nGMwd/GHo40TwuAIlzjDINRAjCJk8cGoYRAG60iMBwCD3jCQMEj40QAAAABJRU5ErkJggg==';
const bytes = decode(png);
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => m.set(k, v),
    removeItem: (k: string) => m.delete(k),
  };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function zip() {
  const compressed = deflateRawSync(bytes),
    name = Buffer.from('image.png'),
    header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Uint8Array.from(Buffer.concat([header, name, compressed]));
}
describe('后端协议（Mock）', () => {
  it.each(['openai', 'sd', 'novelai', 'comfy'] as const)('%s 单次生成及原生响应', async (backend) => {
    const c = structuredClone(defaults);
    c.backend = backend;
    const p = c.connections[backend];
    p.base = 'https://image.example/v1';
    p.workflow = JSON.stringify({ '3': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt' } } });
    imageVault().set(credentialId(backend, p.base), 'fixture-secret');
    const send = vi.fn(async (url: string) => {
      if (url.endsWith('/generate-image')) return new Response(zip());
      if (url.endsWith('/prompt')) return Response.json({ prompt_id: 'pid' });
      if (url.endsWith('/history/pid'))
        return Response.json({
          pid: { outputs: { '4': { images: [{ filename: 'result.png', type: 'output' }] } } },
        });
      if (url.includes('/view?') || url === 'https://cdn.example/r.png') return new Response(bytes);
      return Response.json(
        backend === 'openai' ? { data: [{ url: 'https://cdn.example/r.png' }] } : { images: [png] },
      );
    });
    vi.stubGlobal('fetch', send);
    expect(await generateImage(c, 'portrait', 'blur', AbortSignal.timeout(3000))).toEqual(bytes);
    const calls = send.mock.calls as unknown as [string, RequestInit][];
    expect(calls.filter(([, o]) => o.method === 'POST')).toHaveLength(1);
    const body = JSON.parse(String(calls[0][1].body));
    expect(JSON.stringify(body)).not.toContain('fixture-secret');
    if (backend === 'sd') expect(body).toMatchObject({ negative_prompt: 'blur', batch_size: 1, n_iter: 1 });
    if (backend === 'novelai') expect(body.parameters.v4_prompt.caption.base_caption).toBe('portrait');
    if (backend === 'comfy') expect(body.prompt['3'].inputs.text).toBe('portrait');
    if (backend === 'openai')
      expect(calls[1][1]).toMatchObject({ headers: {}, credentials: 'omit', redirect: 'error' });
  });
  it('拒绝非位图和超限 ZIP，文本错误不回显密钥，探测只读', async () => {
    expect(() => rasterMime(new TextEncoder().encode('<svg/>'))).toThrow();
    const bad = zip();
    new DataView(bad.buffer).setUint32(22, 2 ** 26, true);
    await expect(unpack(bad)).rejects.toThrow();
    const c = structuredClone(defaults);
    c.textBase = c.connections.openai.base = 'https://example.test';
    c.textModel = 'text';
    const f = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(new Response('fixture-secret', { status: 401 }));
    vi.stubGlobal('fetch', f);
    await probe(c, new AbortController().signal);
    expect(f.mock.calls[0][1].method).toBe('GET');
    await expect(convertText(c, '人物', '30 岁', new AbortController().signal)).rejects.toThrow(
      /^接口返回 HTTP 401$/,
    );
    expect(归一化单段词组转化器输出('<think>private</think><词组>portrait, brown eyes</词组>')).toBe(
      'portrait, brown eyes',
    );
    c.backend = 'sd';
    expect(buildRequest(c, '玻璃杯', '虚焦')).not.toHaveProperty('model');
  });
});
describe('存档附属资源', () => {
  let repo: SaveRepository;
  beforeEach(async () => {
    repo = await SaveRepository.open('pictures', new IDBFactory());
  });
  afterEach(() => repo.close());
  it('同名隔离、锚点、槽位、去重和备份覆盖确认', async () => {
    const s = game(),
      other = game('save-b');
    s.npc['npc-a'] = npc();
    await repo.create(s);
    await repo.create(other);
    const t = targetFor(s, 'npc', 'npc-a')!,
      scope = { saveId: s.saveId, createdAt: s.createdAt };
    await repo.images.anchor(scope, t, '圆框眼镜');
    await repo.images.save(scope, t, 'avatar', bytes);
    await repo.images.save(scope, t, 'full', bytes);
    const j: Job = {
      id: 'first',
      scope,
      saveId: s.saveId,
      target: t,
      slot: 'avatar',
      phase: '等待',
      message: '',
      time: 1,
      automatic: true,
    };
    expect(await repo.images.enqueue(j)).toBe(false);
    expect(await repo.images.enqueue({ ...j, slot: 'bust' })).toBe(true);
    expect(await repo.images.enqueue({ ...j, slot: 'bust' })).toBe(false);
    expect((await repo.images.read(other.saveId)).library.pictures).toEqual([]);
    const [entry] = await repo.exportBackup([s.saveId]);
    const text = await serializeBackup([entry], 'mock');
    expect(JSON.parse(text).version).toBe(3);
    expect(text).not.toContain('imageJobs');
    expect(text).not.toContain('fixture-secret');
    const [parsed] = (await parseBackup(text)).entries;
    if (!parsed.ok) throw Error('parse');
    expect(parsed.images?.pictures.filter((p) => p.current)).toHaveLength(2);
    const lightweight = (await repo.exportBackup([s.saveId], false))[0];
    expect(lightweight.images).toBeUndefined();
    const compare = await repo.compareBackup(parsed);
    await repo.images.anchor(scope, t, '新眼镜');
    await expect(repo.importBackup(parsed, compare.confirmation, { overwrite: true })).rejects.toMatchObject({
      code: 'IMPORT_CONFLICT',
    });
    const restored = await repo.importBackup(parsed, (await repo.compareBackup(parsed)).confirmation, {
      overwrite: true,
    });
    expect((await repo.images.read(s.saveId)).library.anchors[0].text).toBe('圆框眼镜');
    await expect(repo.images.save(scope, t, 'bust', bytes)).rejects.toThrow('替换');
    await repo.delete(s.saveId, restored.revision, (await repo.loadGame(s.saveId)).instance);
    expect(await repo.images.file(s.saveId, entry.images!.pictures[0].id)).toBeUndefined();
  });
  it('回溯标记历史、同名新 ID 不接管、相册只引用已有图片', async () => {
    const s = game();
    s.turnNumber = s.revision = 1;
    s.journal = [{ revision: 1, turnId: 'first-turn', story, relatedActorRefs: [] }];
    await repo.importBackup({ state: s }, (await repo.compareBackup({ state: s })).confirmation);
    const { instance } = await repo.loadGame(s.saveId),
      scope = { saveId: s.saveId, createdAt: s.createdAt, instance };
    const t = targetFor(s, 'story', 'first-turn')!;
    await repo.images.save(scope, t, 'illustration', bytes);
    const p = (await repo.images.read(s.saveId)).library.pictures[0];
    await repo.images.edit(scope, p.id, 'album', '旧相册');
    const back = game();
    back.createdAt = s.createdAt;
    await repo.importBackup({ state: back }, (await repo.compareBackup({ state: back })).confirmation, {
      overwrite: true,
    });
    const [entry] = await repo.exportBackup([s.saveId]);
    expect(entry.images?.files).toHaveLength(1);
    expect(validTarget(entry.state, t)).toBe(false);
    expect(entry.images?.pictures[0].album).toBe('旧相册');
    expect(entry.state.journal).toHaveLength(0);
  });
  it('空间不足回滚文件与元数据', async () => {
    const s = game();
    await repo.create(s);
    const original = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof original>
    ) {
      if (this.name === 'imageFiles') throw new DOMException('quota', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(repo.images.save(s, targetFor(s, 'player', 'hero')!, 'avatar', bytes)).rejects.toThrow(
      '空间不足',
    );
    expect((await repo.images.read(s.saveId)).library.pictures).toHaveLength(0);
  });
});

describe('任务费用与队列状态（Mock）', () => {
  it.each(['player', 'npc', 'place', 'item', 'vehicle'] as const)(
    '%s 仅向图片后端提供目标资料',
    async (kind) => {
      const { enqueue } = await import('../services/images/queue');
      const { saveConfig } = await import('../services/images/config');
      vi.stubGlobal('window', new EventTarget());
      const c = structuredClone(defaults);
      c.enabled = true;
      c.connections.openai.base = 'https://image.example/v1';
      saveConfig(c);
      const s = game();
      s.npc['npc-a'] = { ...npc(), background: '无关隐私标记' };
      s.items.ring = {
        id: 'ring',
        name: '银戒指',
        category: 'accessory',
        quantity: 1,
        conditionText: '银质',
      };
      s.economy.vehicles.car = {
        id: 'car',
        name: '黑色轿车',
        kind: 'vehicle',
        model: '轿车',
        source: '购入',
        statusText: '可用',
        ownerRef: { kind: 'protagonist', id: 'hero' },
        estimatedValue: null,
      };
      const repo = await SaveRepository.open(kind, new IDBFactory());
      const f = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: png }] }));
      vi.stubGlobal('fetch', f);
      try {
        await repo.create(s);
        const t = targetFor(
          s,
          kind,
          { player: 'hero', npc: 'npc-a', place: 'chongqing', item: 'ring', vehicle: 'car' }[kind],
        )!;
        const { slotOptions } = await import('../services/images/model');
        await enqueue(repo.images, s, t, slotOptions(kind)[0]);
        const { jobs, library } = await repo.images.read(s.saveId);
        expect(jobs[0].phase).toBe('完成');
        expect(library.pictures[0].target.id).toBe(t.id);
        expect(JSON.stringify(f.mock.calls)).not.toContain('无关隐私标记');
        expect(f).toHaveBeenCalledTimes(1);
        expect((await repo.load(s.saveId)).revision).toBe(0);
      } finally {
        repo.close();
      }
    },
  );
  it('启用转换后只调用文本和图片接口各一次，图片使用转换后的提示词', async () => {
    const { enqueue } = await import('../services/images/queue');
    const { saveConfig } = await import('../services/images/config');
    vi.stubGlobal('window', new EventTarget());
    const c = structuredClone(defaults);
    c.enabled = c.convert = true;
    c.textBase = 'https://text.example';
    c.textModel = 'tokenizer';
    c.connections.openai.base = 'https://image.example/v1';
    saveConfig(c);
    const send = vi.fn(async (url: string, options: RequestInit) => {
      if (url.startsWith(c.textBase)) {
        expect(JSON.parse(String(options.body)).model).toBe('tokenizer');
        localStorage.removeItem('heijin.images.next-request');
        return Response.json({ choices: [{ message: { content: 'portrait with round glasses' } }] });
      }
      expect(JSON.parse(String(options.body)).prompt).toContain('portrait with round glasses');
      return Response.json({ data: [{ b64_json: png }] });
    });
    vi.stubGlobal('fetch', send);
    const s = game();
    const repo = await SaveRepository.open('conversion', new IDBFactory());
    try {
      await repo.create(s);
      await enqueue(repo.images, s, targetFor(s, 'player', 'hero')!, 'avatar');
      expect((await repo.images.read(s.saveId)).jobs[0].phase).toBe('完成');
      expect(send.mock.calls.map(([url]) => url)).toEqual([
        'https://text.example/chat/completions',
        'https://image.example/v1/images/generations',
      ]);
    } finally {
      repo.close();
    }
  });
  it('转换失败仅请求文本一次，超时或取消不自动重发', async () => {
    const { enqueue } = await import('../services/images/queue'),
      { saveConfig } = await import('../services/images/config');
    vi.stubGlobal('window', new EventTarget());
    const c = structuredClone(defaults);
    c.enabled = c.convert = true;
    c.textBase = 'https://text.example';
    c.textModel = 'tokenizer';
    saveConfig(c);
    const s = game(),
      repo = await SaveRepository.open('fee', new IDBFactory()),
      f = vi.fn().mockResolvedValue(new Response('secret-provider-body', { status: 429 }));
    vi.stubGlobal('fetch', f);
    try {
      await repo.create(s);
      await enqueue(repo.images, s, targetFor(s, 'player', 'hero')!, 'avatar');
      const { jobs, library } = await repo.images.read(s.saveId);
      expect(jobs[0]).toMatchObject({ phase: '失败', message: '接口返回 HTTP 429' });
      expect(library.pictures).toHaveLength(0);
      expect(f).toHaveBeenCalledTimes(1);
      expect(f.mock.calls[0][0]).toBe('https://text.example/chat/completions');
      localStorage.removeItem('heijin.images.next-request');
      c.convert = false;
      c.connections.openai.base = 'https://image.example/v1';
      saveConfig(c);
      f.mockRejectedValue(new DOMException('expired', 'TimeoutError'));
      await enqueue(repo.images, s, targetFor(s, 'player', 'hero')!, 'avatar');
      expect((await repo.images.read(s.saveId)).jobs.find((j) => j.message.includes('超时'))?.phase).toBe(
        '失败',
      );
      expect(f).toHaveBeenCalledTimes(2);
    } finally {
      repo.close();
    }
  });
});

it('正式撤回和历史节点覆盖保留原图，禁止旧任务越过存档实例', async () => {
  const { worldState } = await import('./fixtures/world');
  const { completeDraft, elapsedVariables, submission } = await import('./fixtures/turn');
  const repo = await SaveRepository.open('history-images', new IDBFactory());
  try {
    await repo.create(worldState());
    async function turn() {
      const { draft } = await repo.loadGame('save-a');
      if (draft && !draft.userInput) await repo.bindTurnAction(draft, '继续', true, true);
      return repo.commitTurn(
        submission(
          await completeDraft(repo, { variables: await elapsedVariables(repo, '时间经过', 60) }),
          '',
        ),
      );
    }
    await turn();
    const node = await repo.history.create('save-a', '第一回合');
    const { state, draft } = await turn(),
      target = targetFor(state, 'story', state.journal.at(-1)!.turnId)!;
    const scope = { saveId: state.saveId, createdAt: state.createdAt };
    await repo.images.save(scope, target, 'illustration', bytes);
    const undone = await repo.undoTurn({
      saveId: scope.saveId,
      expectedRevision: state.revision,
      expectedDraft: draft,
      operationId: 'undo-image',
    });
    expect(validTarget(undone.state, target)).toBe(false);
    expect((await repo.images.read(scope.saveId)).library.pictures).toHaveLength(1);
    await turn();
    const preview = await repo.history.preview(scope.saveId, { kind: 'manual', id: node.id });
    const restored = await repo.history.restore(preview.confirmation, '重新开始', true, true);
    expect(validTarget(restored.state, target)).toBe(false);
    await expect(repo.images.save(scope, target, 'illustration', bytes)).rejects.toThrow('替换');
    expect((await repo.exportBackup([scope.saveId]))[0].images?.files).toHaveLength(1);
  } finally {
    repo.close();
  }
});
