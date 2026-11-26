import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { deflateRawSync } from 'node:zlib';
import { SaveRepository } from '../services/storage/saveRepository';
import { parseBackup, serializeBackup } from '../services/storage/backup';
import { buildRequest, convertText, generateImage, probe } from '../services/images/protocol';
import { config, defaults, credentialId, imageVault } from '../services/images/config';
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
  vi.stubGlobal('indexedDB', new IDBFactory());
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
it('旧版文生图配置保留用户设置并补齐居家照模板', async () => {
  const { config, configKey } = await import('../services/images/config');
  const c = structuredClone(defaults);
  c.enabled = true;
  c.templates.person = '旧存档自定义人物模板';
  c.connections.openai.model = 'old-model';
  const { home: removed, ...oldTemplates } = c.templates;
  localStorage.setItem(configKey, JSON.stringify({ ...c, templates: oldTemplates }));
  expect(config()).toMatchObject({
    enabled: true,
    connections: { openai: { model: 'old-model' } },
    templates: { person: c.templates.person, home: removed },
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
    expect(JSON.parse(text).version).toBe(4);
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
  it('四种人物用途各自保存当前图、历史和备份；家庭退出后资源可导出、删除', async () => {
    const { householdFixture } = await import('./fixtures/harem');
    const s = householdFixture(2),
      t = targetFor(s, 'npc', 'family-1')!;
    await repo.importBackup({ state: s }, (await repo.compareBackup({ state: s })).confirmation);
    const scope = {
      saveId: s.saveId,
      createdAt: s.createdAt,
      instance: (await repo.loadGame(s.saveId)).instance,
    };
    for (const slot of ['avatar', 'bust', 'full', 'home', 'home'] as const)
      await repo.images.save(scope, t, slot, bytes);
    expect(
      await repo.images.enqueue({
        id: 'automatic-home',
        saveId: s.saveId,
        scope,
        target: t,
        slot: 'home',
        automatic: true,
        phase: '等待',
        message: '',
        time: 1,
      }),
    ).toBe(false);
    expect((await repo.images.read(s.saveId)).jobs).toHaveLength(0);
    const [backup] = await repo.exportBackup([s.saveId]);
    const bundle = await parseBackup(await serializeBackup([backup], 'test'));
    const restored = bundle.entries[0];
    if (!restored.ok) throw Error('备份无效');
    expect(
      restored.images?.pictures
        .filter((p) => p.current)
        .map((p) => p.slot)
        .sort(),
    ).toEqual(['avatar', 'bust', 'full', 'home'].sort());
    const oldHome = restored.images!.pictures.find((p) => p.slot === 'home')!;
    await repo.images.edit(scope, oldHome.id, 'use');
    const exited = structuredClone(s);
    const m = exited.harem!.members[t.id];
    m.changes.push({ ...m.changes.at(-1)!, from: m.changes.at(-1)!.to, to: null, reason: '退出家庭' });
    const light = { state: exited };
    await repo.importBackup(light, (await repo.compareBackup(light)).confirmation, { overwrite: true });
    const now = await repo.loadGame(s.saveId);
    expect(await repo.images.file(s.saveId, oldHome.id, scope)).toBeUndefined();
    expect((await repo.exportBackup([s.saveId]))[0].images?.files).toHaveLength(5);
    expect(
      (await repo.images.read(s.saveId)).library.pictures.find((p) => p.id === oldHome.id)?.current,
    ).toBe(true);
    await repo.images.edit({ ...scope, instance: now.instance }, oldHome.id, 'delete');
    expect(await repo.images.file(s.saveId, oldHome.id)).toBeUndefined();
    expect((await repo.images.read(s.saveId)).library.pictures.filter((p) => p.current)).toHaveLength(3);
    await repo.importBackup(restored, (await repo.compareBackup(restored)).confirmation, { overwrite: true });
    expect((await repo.images.read(s.saveId)).library.pictures).toHaveLength(5);
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
  it.each(['ordinary', 'special', 'item', 'story'] as const)(
    '%s 等待期间错过关停与重启通知，取得执行锁时仍停止旧任务',
    async (rule) => {
      const { saveConfig } = await import('../services/images/config');
      const { afterSettlement } = await import('../services/images/queue');
      vi.stubGlobal('window', new EventTarget());
      // A suspended tab receives no events until after the global queue is released.
      vi.spyOn(window, 'dispatchEvent').mockReturnValue(true);
      const send = vi.fn();
      vi.stubGlobal('fetch', send);
      const before = game(),
        state = structuredClone(before),
        repo = await SaveRepository.open(rule, new IDBFactory());
      try {
        state.revision = state.turnNumber = 1;
        state.journal = [{ revision: 1, turnId: 'new-turn', story, relatedActorRefs: [] }];
        state.npc['npc-a'] = npc();
        state.npc.important = {
          ...npc('important'),
          kind: 'special',
          detailedBackground: '',
          activeGoals: [],
          habits: [],
          offscreenTaskIds: [],
          longTermMemories: [],
        };
        state.items.ring = {
          id: 'ring',
          name: '银戒指',
          category: 'accessory',
          quantity: 1,
          conditionText: '完好',
          ownerRef: { kind: 'protagonist', id: 'hero' },
        };
        await repo.importBackup({ state }, (await repo.compareBackup({ state })).confirmation);
        const { instance } = await repo.loadGame(state.saveId);
        const base = config(),
          on = { ...base, enabled: true, auto: { ...base.auto, [rule]: true } };
        await saveConfig(base, on);
        const phase = async () => (await repo.images.read(state.saveId)).jobs.map((j) => j.phase);
        await navigator.locks.request('heijin.image-generation.v1', async () => {
          afterSettlement(repo.images, before, state, instance);
          await vi.waitFor(async () => expect(await phase()).toEqual(['等待']));
          const off = { ...on, auto: { ...on.auto, [rule]: false } };
          await saveConfig(on, off);
          await saveConfig(off, on);
        });
        await vi.waitFor(async () => expect(await phase()).toEqual(['取消']));
        expect(send).not.toHaveBeenCalled();
      } finally {
        repo.close();
      }
    },
  );
  it('跨进程显示缓存仍旧时以事务记录为准，缓存写满则回滚并可重试', async () => {
    const { configKey, savedConfig, saveConfig } = await import('../services/images/config');
    vi.stubGlobal('window', new EventTarget());
    const base = config();
    await saveConfig(base, { ...base, style: '已提交' });
    localStorage.setItem(configKey, JSON.stringify(base));
    await saveConfig(base, { ...base, positive: '另一个字段' });
    const current = (await savedConfig()).value;
    expect(current).toMatchObject({ style: '已提交', positive: '另一个字段' });
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const next = { ...current, negative: '重试' };
    await expect(saveConfig(current, next)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect((await savedConfig()).value).toEqual(current);
    await saveConfig(current, next);
    expect(config()).toEqual(next);
  });
  it('同字段的过期写入在事务内被拒绝，保留已提交的值', async () => {
    const { saveConfig } = await import('../services/images/config');
    vi.stubGlobal('window', new EventTarget());
    const base = config();
    await saveConfig(base, { ...base, style: '甲' });
    await expect(saveConfig(base, { ...base, style: '乙', positive: '尚未保存' })).rejects.toThrow(
      '同一设置',
    );
    expect(config()).toMatchObject({ style: '甲', positive: '' });
    const latest = config();
    await saveConfig(latest, { ...latest, positive: '保留画风再保存' });
    expect(config().style).toBe('甲');
  });
  it.each(['player', 'npc', 'place', 'item', 'vehicle'] as const)(
    '%s 仅向图片后端提供目标资料',
    async (kind) => {
      const { enqueue } = await import('../services/images/queue');
      const { saveConfig } = await import('../services/images/config');
      vi.stubGlobal('window', new EventTarget());
      const c = structuredClone(defaults);
      c.enabled = true;
      c.connections.openai.base = 'https://image.example/v1';
      await saveConfig(config(), c);
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
    await saveConfig(config(), c);
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
  it('缺失同期快照的旧剧情只发送当时正文及场景，不发送当下年龄、外貌和锚点', async () => {
    const { enqueue } = await import('../services/images/queue');
    const { saveConfig } = await import('../services/images/config');
    vi.stubGlobal('window', new EventTarget());
    const c = structuredClone(defaults);
    c.enabled = true;
    c.connections.openai.base = 'https://image.example';
    await saveConfig(config(), c);
    const s = game();
    s.npc['npc-a'] = { ...npc(), appearance: '晚年的外貌标记' };
    s.revision = s.turnNumber = 2;
    s.journal = ['past', 'current'].map((turnId, i) => ({
      revision: i + 1,
      turnId,
      story: { ...story, narrative: (i ? '现在' : '过去') + '的衣装' },
      relatedActorRefs: [{ kind: 'npc', id: 'npc-a' }],
      scene: { worldClock: s.worldClock, locationId: 'chongqing' },
    }));
    const repo = await SaveRepository.open('visual-past', new IDBFactory());
    const f = vi.fn().mockResolvedValue(Response.json({ data: [{ b64_json: png }] }));
    vi.stubGlobal('fetch', f);
    try {
      const input = { state: s };
      await repo.importBackup(input, (await repo.compareBackup(input)).confirmation);
      const loaded = await repo.loadGame(s.saveId);
      const scope = { saveId: s.saveId, createdAt: s.createdAt, instance: loaded.instance };
      await repo.images.anchor(scope, targetFor(s, 'npc', 'npc-a')!, '当前才有的眼镜');
      await enqueue(repo.images, scope, targetFor(s, 'story', 'past')!, 'illustration');
      expect(f).toHaveBeenCalledTimes(1);
      const prompt = JSON.parse(f.mock.calls[0][1].body).prompt;
      expect(prompt).toContain('过去的衣装');
      expect(prompt).toContain(s.worldClock);
      expect(prompt).not.toMatch(/晚年的外貌标记|当前才有的眼镜|现在的衣装/);
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
    await saveConfig(config(), c);
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
      await saveConfig(config(), c);
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
    const historical = await repo.images.storyState(state, state.journal[0].turnId);
    expect(historical?.turnNumber).toBe(1);
    expect(historical?.worldClock).not.toBe(state.worldClock);
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
    const restored = await repo.history.restore(preview.confirmation, '重新开始', true, true, false);
    expect((await repo.loadGame(scope.saveId)).draft).toMatchObject({
      useEntityStage: false, useVariableStage: true, useWorldStage: true,
      stageStatus: { entities: 'skipped' },
    });
    expect(validTarget(restored.state, target)).toBe(false);
    await expect(repo.images.save(scope, target, 'illustration', bytes)).rejects.toThrow('替换');
    expect((await repo.exportBackup([scope.saveId]))[0].images?.files).toHaveLength(1);
  } finally {
    repo.close();
  }
});
