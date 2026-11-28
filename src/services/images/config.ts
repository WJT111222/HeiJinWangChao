import { z } from 'zod';
import { CredentialVault } from '../ai/credentials';
import { request, transaction } from '../storage/idb';

export const backendNames = { openai: 'OpenAI 兼容', novelai: 'NovelAI', comfy: 'ComfyUI', sd: 'SD WebUI' };
export type Backend = keyof typeof backendNames;
export const templates = {
  person: '将人物档案转为单人肖像描述。保留真实年龄、身份及已知外貌，沿用给定形象锚点。',
  home: '描绘单人在家中阅读、做饭或休息的日常瞬间。自然便装、环境光，保留人物辨识度与生活空间。',
  story: '选择这个已结算片段中一个具体时刻，描述相关人物、动作与环境，保留所给人物外貌。',
  place: '描述这个地点的用途、空间、光线与材质，画面重点为环境。',
  item: '为指定物品制作单件物品展示，保留可辨识的材质与造型。',
};
export const autoLabels = {
  ordinary: '新普通 NPC 头像',
  special: '新特殊 NPC 头像',
  story: '结算剧情插画',
  item: '获得重要物品',
};
const connection = z.object({
  base: z.string().max(500),
  path: z.string().max(500),
  model: z.string().max(200),
  size: z.string().regex(/^\d{2,4}x\d{2,4}$/),
  sampler: z.string().max(100),
  scheduler: z.string().max(100),
  steps: z.number().int().min(1).max(50),
  cfg: z.number().min(0).max(30),
  seed: z.number().int().min(-1).max(4294967295),
  workflow: z.string().max(500000),
});
const namedPreset = z.object({
  name: z.string().trim().min(1).max(80),
  backend: z.enum(['openai', 'novelai', 'sd', 'comfy']),
  connection,
});
const base = {
  base: '',
  path: '',
  model: '',
  size: '1024x1024',
  steps: 28,
  cfg: 5,
  seed: -1,
  sampler: '',
  scheduler: '',
  workflow: '',
};
export const defaults = {
  enabled: false,
  backend: 'openai' as Backend,
  connections: {
    openai: { ...base, model: 'gpt-image-1' },
    novelai: { ...base, model: 'nai-diffusion-4-5-full' },
    sd: { ...base },
    comfy: { ...base },
  },
  presets: [] as z.infer<typeof namedPreset>[],
  styles: [] as string[],
  convert: false,
  textBase: '',
  textModel: '',
  positive: '',
  negative: '',
  style: '',
  templates,
  auto: { ordinary: false, special: false, story: false, item: false },
  includeImages: true,
};
const schema = z.object({
  presets: z.array(namedPreset).max(24).default([]),
  styles: z.array(z.string().min(1).max(2000)).max(24).default([]),
  enabled: z.boolean(),
  backend: z.enum(['openai', 'novelai', 'sd', 'comfy']),
  connections: z.object({ openai: connection, novelai: connection, sd: connection, comfy: connection }),
  convert: z.boolean(),
  textBase: z.string().max(500),
  textModel: z.string().max(200),
  positive: z.string().max(4000),
  negative: z.string().max(4000),
  style: z.string().max(2000),
  templates: z.object({
    home: z.string().default(templates.home),
    person: z.string(),
    story: z.string(),
    place: z.string(),
    item: z.string(),
  }),
  auto: z.object({ ordinary: z.boolean(), special: z.boolean(), story: z.boolean(), item: z.boolean() }),
  includeImages: z.boolean(),
});
export type ImageConfig = z.infer<typeof schema>;
export const configKey = 'heijin.images.config.v1';
const autoRules = schema.shape.auto.keyof().options;
type StopCounters = Partial<Record<'enabled' | keyof ImageConfig['auto'], number>>;
const storedConfig = schema.extend({
  revision: z.number().int().nonnegative().default(0),
  // A waiting tab may resume after both the disable and the next enable were saved.
  stops: z.partialRecord(z.enum(['enabled', ...autoRules]), z.number().int().nonnegative()).catch({}),
});
export type ConfigSnapshot = { value: ImageConfig; stops: StopCounters; revision: number };
function configSnapshot(): ConfigSnapshot {
  try {
    const { revision, stops, ...value } = storedConfig.parse(
      JSON.parse(localStorage.getItem(configKey) ?? 'null'),
    );
    return { value, stops, revision };
  } catch {
    return { value: structuredClone(defaults), stops: {}, revision: 0 };
  }
}
export const config = () => configSnapshot().value;

// localStorage is the synchronous display cache. Different renderer processes may still have
// different cached values after taking a Web Lock. Commit against the record in a single IDB transaction.
const preferencesStore = 'preferences';
async function withPreferences<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>) {
  const open = indexedDB.open('heijin.image-preferences', 1);
  open.onupgradeneeded = () => open.result.createObjectStore(preferencesStore);
  const db = await request(open);
  db.onversionchange = () => db.close();
  try {
    return await transaction(db, [preferencesStore], mode, (tx) => work(tx.objectStore(preferencesStore)));
  } finally {
    db.close();
  }
}
function readRecord(store: IDBObjectStore): Promise<ConfigSnapshot | undefined> {
  return request(store.get(configKey));
}
export function savedConfig(): Promise<ConfigSnapshot> {
  return withPreferences('readonly', async (store) => (await readRecord(store)) ?? configSnapshot());
}
function cacheConfig(snapshot: ConfigSnapshot) {
  const encoded = JSON.stringify({ ...snapshot.value, stops: snapshot.stops, revision: snapshot.revision });
  if (encoded === localStorage.getItem(configKey)) return false;
  localStorage.setItem(configKey, encoded);
  return true;
}
async function refreshCache(fallback?: ConfigSnapshot) {
  const changed = await withPreferences('readwrite', async (store) => {
    const record = (await readRecord(store)) ?? fallback;
    return record && cacheConfig(record);
  });
  if (changed) window.dispatchEvent(new Event(configKey));
}
let initialized: IDBFactory | undefined;
function refreshCacheOnEntry() {
  const factory = globalThis.indexedDB;
  if (!factory || initialized === factory) return;
  initialized = factory;
  void refreshCache().catch(() => {
    initialized = undefined;
  });
}

// Arrays are one editable field (their order and deletions are meaningful).
export function reconcileConfig(
  base: ImageConfig,
  local: ImageConfig,
  saved: ImageConfig,
  resolve?: { path: string; take: 'local' | 'saved' },
) {
  const nextBase = structuredClone(saved),
    draft = structuredClone(saved),
    conflicts: { path: string; local: unknown; saved: unknown }[] = [];
  type Fields = Record<string, unknown>;
  const same = (a: unknown, b: unknown) =>
    Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);
  function visit(
    before: Fields,
    edits: Fields,
    latest: Fields,
    baseline: Fields,
    output: Fields,
    prefix: string,
  ) {
    for (const key of Object.keys(before)) {
      const original = before[key],
        mine = edits[key],
        theirs = latest[key],
        path = prefix + key;
      if (original !== null && typeof original === 'object' && !Array.isArray(original)) {
        visit(
          original as Fields,
          mine as Fields,
          theirs as Fields,
          baseline[key] as Fields,
          output[key] as Fields,
          path + '.',
        );
        continue;
      }
      if (same(mine, original) || same(mine, theirs)) continue;
      if (!same(theirs, original)) {
        if (resolve?.path === path) {
          if (resolve.take === 'saved') continue;
        } else {
          conflicts.push({ path, local: mine, saved: theirs });
          baseline[key] = original;
        }
      }
      output[key] = mine;
    }
  }
  visit(base, local, saved, nextBase, draft, '');
  return { base: nextBase, draft, saved, conflicts };
}
export async function saveConfig(base: ImageConfig, draft: ImageConfig) {
  let previous: ConfigSnapshot | undefined;
  const result = await withPreferences('readwrite', async (store) => {
    const current = (await readRecord(store)) ?? configSnapshot();
    const merged = reconcileConfig(base, draft, current.value);
    const conflict = merged.conflicts.length > 0;
    let snapshot = current;
    if (!conflict) {
      const value = schema.parse(merged.draft),
        stops = { ...current.stops };
      if (JSON.stringify(value) !== JSON.stringify(current.value)) {
        if (current.value.enabled && !value.enabled) stops.enabled = (stops.enabled ?? 0) + 1;
        for (const key of autoRules)
          if (current.value.auto[key] && !value.auto[key]) stops[key] = (stops[key] ?? 0) + 1;
        snapshot = { value, stops, revision: current.revision + 1 };
        await request(store.put(snapshot, configKey));
      }
    }
    // If publishing fails (e.g. quota), the transaction helper aborts the write.
    if (cacheConfig(snapshot)) previous = current;
    return { snapshot, conflict };
  }).catch(async (error) => {
    // The cache was written, but IDB failed at commit. Keep the last durable value visible.
    if (previous) await refreshCache(previous);
    throw error;
  });
  window.dispatchEvent(new Event(configKey));
  if (result.conflict) throw new Error('其他页面已修改同一设置，请选择要保留的版本。');
  return result.snapshot.value;
}
export function subscribeConfig(fn: () => void) {
  const changed = (e: StorageEvent) => {
    if (e.storageArea && e.storageArea !== localStorage) return;
    if (!e.key || e.key === configKey) fn();
  };
  window.addEventListener('storage', changed);
  window.addEventListener(configKey, fn);
  refreshCacheOnEntry();
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(configKey, fn);
  };
}
export function imageVault() {
  return new CredentialVault(sessionStorage, localStorage);
}
export function endpoint(baseUrl: string, path: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('请填写完整的 API 地址');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('API 地址须为 HTTPS 或本机 HTTP，不含凭证、查询参数或片段');
  if (/[?#\\]/.test(path) || path.includes('://')) throw new Error('接口路径仅可填写同源路径');
  return url.href.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}
// Bind credentials to the destination origin, including when the endpoint is edited in another tab.
export function credentialId(kind: Backend | 'text', baseUrl: string) {
  return 'image.' + kind + '.' + new URL(endpoint(baseUrl, '')).origin;
}
