import { credentialScope } from '../../services/ai/compatibleEndpoints';
import { aiConfigKey, AiConfigSchema, type AiConfig, type ModelRoute } from '../../services/ai/configuration';
import type { VaultSnapshot } from '../../services/ai/credentials';
import { request, transaction } from '../../services/storage/idb';
import { detectPreset, type PresetId } from './aiPresets';

export interface AiDraft {
  config: AiConfig;
  keys: Record<string, string>;
  remember: Record<string, boolean>;
  presets: Record<string, PresetId | ''>;
}

export function storedDraft(config: AiConfig, credentials: VaultSnapshot): AiDraft {
  const draft: AiDraft = { config, keys: {}, remember: {}, presets: {} };
  for (const channel of config.channels) {
    const entry = credentials.find(item => item.id === channel.id);
    const key = entry?.session ?? entry?.persistent ?? '';
    draft.keys[channel.id] = key;
    draft.remember[channel.id] = key ? entry?.persistent != null : true;
    draft.presets[channel.id] = detectPreset(channel);
  }
  return draft;
}

export class AiConfigConflict extends Error {
  constructor(field: string) {
    super(`其他标签页已修改${field}，本次未保存。当前编辑已保留；可点「放弃修改」载入最新配置后重新编辑。`);
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function mergeField(base: unknown, mine: unknown, latest: unknown, label: string): unknown {
  if (same(base, mine) || same(mine, latest)) return latest;
  if (same(base, latest)) return mine;
  if (record(base) && record(mine) && record(latest)) {
    return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(latest)])]
      .map(key => [key, mergeField(base[key], mine[key], latest[key], label)]));
  }
  throw new AiConfigConflict(label);
}

export function effectiveRouteModel(config: AiConfig, route: { channelId: string; modelId: string }) {
  return route.modelId || config.channels.find(channel => channel.id === route.channelId)?.defaultModel || '';
}

export function mergeAiDraft(base: AiDraft, mine: AiDraft, latest: AiDraft, before: VaultSnapshot, now: VaultSnapshot) {
  const channels = [];
  const remove: string[] = [], write: string[] = [];
  const ids = new Set([...latest.config.channels, ...mine.config.channels, ...base.config.channels].map(channel => channel.id));
  for (const id of ids) {
    const channel = (draft: AiDraft) => draft.config.channels.find(item => item.id === id);
    const b = channel(base), m = channel(mine), r = channel(latest);
    const label = `渠道「${r?.name || m?.name || b?.name}」`;
    const mineSecret = (mine.keys[id] ?? '') !== (base.keys[id] ?? '') || mine.remember[id] !== base.remember[id];
    const existing = now.find(item => item.id === id);
    const original = before.find(item => item.id === id);
    const sharedChanged = (original?.persistent ?? null) !== (existing?.persistent ?? null);
    if (b && (!m || !r)) {
      if (!m && !r) continue;
      if (!m && (!same(b, r) || sharedChanged) || !r && (!same(b, m) || mineSecret)) throw new AiConfigConflict(label);
      if (!m) remove.push(id);
      continue;
    }
    if (!b && m && (r || sharedChanged)) throw new AiConfigConflict(label);
    if (b && m && r) {
      const localEndpoint = credentialScope(b.baseUrl) !== credentialScope(m.baseUrl);
      const remoteEndpoint = credentialScope(b.baseUrl) !== credentialScope(r.baseUrl);
      const key = mine.keys[id]?.trim() || null;
      const sameCredential = (existing?.persistent ?? null) === (mine.remember[id] ? key : null)
        && (existing?.session ?? null) === (mine.remember[id] ? null : key);
      if ((mineSecret || localEndpoint) && sharedChanged && !sameCredential
          || mineSecret && remoteEndpoint && credentialScope(m.baseUrl) !== credentialScope(r.baseUrl))
        throw new AiConfigConflict(label + '的密钥或服务地址');
      // Protocol and endpoint must continue to describe the same provider.
      if ((b.protocol !== m.protocol && b.baseUrl !== r.baseUrl || b.protocol !== r.protocol && b.baseUrl !== m.baseUrl)
          && (m.protocol !== r.protocol || m.baseUrl !== r.baseUrl)) throw new AiConfigConflict(label + '的服务商');
    }
    channels.push(mergeField(b, m, r, label));
    if (m && (mineSecret || !b)) write.push(id);
  }
  const routes = { ...latest.config.routes };
  for (const stage of Object.keys(routes) as ModelRoute[]) {
    const b = base.config.routes[stage], m = mine.config.routes[stage], r = routes[stage];
    if (same(b, m) || same(m, r)) continue;
    if (!same(b, r)) throw new AiConfigConflict('模型分配中的同一任务');
    Object.assign(routes, { [stage]: m });
  }
  const result = AiConfigSchema.safeParse({ ...latest.config, channels, routes });
  if (!result.success) throw new AiConfigConflict('相互依赖的渠道或模型分配');
  const merged = result.data;
  const invalidModel = Object.values(merged.routes).some(route => 'channelId' in route
    && (merged.channels.length > 0 || 'mode' in route)
    && (!route.channelId || !effectiveRouteModel(merged, route)));
  if (invalidModel) throw new AiConfigConflict('模型分配依赖的渠道默认模型');
  const draft = storedDraft(merged, now);
  for (const id of write) {
    draft.keys[id] = (mine.keys[id] ?? '').trim();
    draft.remember[id] = mine.remember[id] ?? true;
  }
  return { draft, remove, write };
}

// localStorage can still show an earlier renderer snapshot after an exclusive Web Lock.
// The last opaque receipt is published *after* all synchronous vault/config writes. A writer
// must observe its predecessor's receipt before it is allowed to read and merge those values.
const receiptKey = 'heijin.ai.settings-receipt.v1';
type Receipt = { id: string; time: number };
const parentOf = (id?: string) => id?.split('/')[0] ?? '-';
function newReceipt(previous?: Receipt): Receipt {
  // A published child of the durable ID can only be ahead of it after an abort.
  // Store one generation of opaque IDs, never settings or credential material.
  return { id: crypto.randomUUID() + '/' + parentOf(previous?.id), time: performance.timeOrigin + performance.now() };
}

export class AiSaveFailure extends Error {}
export class AiReloadRequired extends AiSaveFailure {
  constructor(reason: string) {
    super(reason + ' 当前草稿已保留，请重新读取最新配置后再保存。');
  }
}
type Undo = () => string | undefined;

async function openReceiptDb() {
  const open = indexedDB.open('heijin.ai-settings-lock', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('lock');
  const db = await request(open);
  db.onversionchange = () => db.close();
  return db;
}

// Old builds used unrelated UUIDs, so an orphan cannot authorize an automatic merge.
// Only the player's explicit discard may reconcile this exact observed legacy pair.
export class LegacyReceiptConflict extends AiSaveFailure {
  constructor(private durable: string | undefined, private visible: string) {
    super('保存失败：旧版同步标记不一致。编辑已保留。请关闭其他设置标签页，再点「放弃修改」重新读取实际配置和密钥。');
  }
  async reconcile() {
    const db = await openReceiptDb();
    try {
      await exclusiveSave(() => transaction(db, ['lock'], 'readwrite', async tx => {
        const store = tx.objectStore('lock');
        const previous: Receipt | undefined = await request(store.get('published'));
        const visible = localStorage.getItem(receiptKey);
        if (previous?.id === visible) return;
        if (previous?.id !== this.durable || visible !== this.visible) throw new AiConfigConflict('同步状态');
        const fence = newReceipt(previous);
        await request(store.put(fence, 'published'));
        localStorage.setItem(receiptKey, fence.id);
      }));
    } finally { db.close(); }
  }
}
const legacyId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Keep a failed writer exclusive until its Web Storage compensation finishes as well.
// On browsers without Web Locks, an independent IDB transaction provides the same exclusion.
async function exclusiveSave<T>(run: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('heijin.ai.settings-commit.v1', run);
  const open = indexedDB.open('heijin.ai-settings-writers', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('writers');
  const db = await request(open);
  try {
    const tx = db.transaction('writers', 'readwrite');
    const store = tx.objectStore('writers');
    await request(store.get(0)); // acquire the writer before entering the receipt database
    let finished = false;
    const hold = () => { if (!finished) store.get(0).onsuccess = hold; };
    hold();
    // This gate contains no data. Only the inner receipt transaction commits a save.
    try { return await run(); } finally { finished = true; }
  } finally { db.close(); }
}

type SaveWork<T> = (publish: () => void, registerUndo: (undo: Undo) => void) => T;

async function recoverSave(db: IDBDatabase, previous: Receipt | undefined, originalMarker: string | null,
  attempted: Receipt, undo: Undo): Promise<never> {
  let detail: string | undefined;
  let checked = false;
  try {
    // Recheck ownership under the original IDB lock too: an older tab may use only that lock.
    await transaction(db, ['lock'], 'readwrite', async tx => {
      const store = tx.objectStore('lock');
      const durable: Receipt | undefined = await request(store.get('published'));
      const visible = localStorage.getItem(receiptKey);
      if (durable?.id !== previous?.id || (visible !== attempted.id && visible !== originalMarker))
        throw new AiReloadRequired('保存失败：其他标签页已更新配置，本页无法安全回滚。');
      detail = undo();
      checked = true;
      // Publish the compensation, including verified residuals, under a fresh fence.
      // Reusing the old ID could authorize another renderer's stale Web Storage cache.
      const fence = newReceipt(previous);
      await request(store.put(fence, 'published'));
      localStorage.setItem(receiptKey, fence.id);
    });
  } catch (error) {
    if (error instanceof AiSaveFailure) throw error;
    const state = checked ? (detail ?? '已核对配置、密钥值及存放位置均已恢复。') : '配置和密钥的恢复状态也未能核验。';
    throw new AiReloadRequired('保存失败：同步标记未能确认恢复。' + state);
  }
  if (detail) throw new AiReloadRequired(detail);
  throw new AiSaveFailure('保存失败，请检查浏览器存储权限或空间后重试。密钥和配置都保持原样，编辑仍未保存。');
}

type SettingsOperation<T> = { save: SaveWork<T> } | { read: () => T };

async function runAttempt<T>(db: IDBDatabase, operation: SettingsOperation<T>) {
  let recover: (() => Promise<never>) | undefined;
  try {
    return await transaction(db, ['lock'], 'readwrite', async tx => {
      const store = tx.objectStore('lock');
      const previous: Receipt | undefined = await request(store.get('published'));
      const visible = localStorage.getItem(receiptKey);
      const freshEmpty = previous && previous.time < performance.timeOrigin && visible === null
        && localStorage.getItem(aiConfigKey) === null;
      // A failed compensation can leave the visible token ahead. Its parent proves this
      // renderer saw the durable predecessor; an arbitrary mismatch grants no such authority.
      const abortedChild = visible?.split('/')[1] === parentOf(previous?.id);
      if ((previous?.id ?? null) !== visible && !freshEmpty && !abortedChild) {
        const legacy = visible && legacyId.test(visible)
          && (!previous || (previous.time < performance.timeOrigin && legacyId.test(previous.id)));
        return { waiting: true as const, legacy: legacy ? new LegacyReceiptConflict(previous?.id, visible) : undefined };
      }

      if ('read' in operation) {
        const value = operation.read();
        // An aligned snapshot needs no writes. Repair only a recognized receipt mismatch.
        if ((previous?.id ?? null) !== visible) {
          const fence = newReceipt(previous);
          await request(store.put(fence, 'published'));
          localStorage.setItem(receiptKey, fence.id);
        }
        return { value };
      }
      const receipt = newReceipt(previous);
      await request(store.put(receipt, 'published'));
      let published = false;
      const value = operation.save(() => {
        localStorage.setItem(receiptKey, receipt.id);
        published = true;
      }, undo => { recover = () => recoverSave(db, previous, visible, receipt, undo); });
      if (!published) {
        if (previous) await request(store.put(previous, 'published'));
        else await request(store.delete('published'));
      }
      return { value };
    });
  } catch (error) {
    if (recover) return recover();
    throw error;
  }
}

async function withSyncedSettings<T>(operation: SettingsOperation<T>): Promise<T> {
  const db = await openReceiptDb();
  const deadline = performance.now() + 5000;
  try {
    while (true) {
      const attempt = await exclusiveSave(() => runAttempt(db, operation));
      if (!('waiting' in attempt)) return attempt.value;
      if (performance.now() >= deadline) throw attempt.legacy ?? new AiConfigConflict('尚未同步的配置');
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  } finally { db.close(); }
}

export function withAiSaveLock<T>(work: SaveWork<T>) {
  return withSyncedSettings({ save: work });
}

export function readLatestAiSettings<T>(read: () => T) {
  return withSyncedSettings({ read });
}
