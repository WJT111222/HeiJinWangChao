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
    if (!b && m && r) throw new AiConfigConflict(label);
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
  const draft = storedDraft(result.data, now);
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
export async function withAiSaveLock(work: (publish: () => void) => void) {
  const open = indexedDB.open('heijin.ai-settings-lock', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('lock');
  const db = await request(open);
  db.onversionchange = () => db.close();
  const deadline = performance.now() + 5000;
  try {
    while (true) {
      const completed = await transaction(db, ['lock'], 'readwrite', async tx => {
        const store = tx.objectStore('lock');
        const previous: Receipt | undefined = await request(store.get('published'));
        const visible = localStorage.getItem(receiptKey);
        // A new document may start after a player has cleared localStorage independently of IDB.
        const freshEmpty = previous && previous.time < performance.timeOrigin && visible === null
          && localStorage.getItem(aiConfigKey) === null;
        if (previous && previous.id !== visible && !freshEmpty) return false;
        const receipt: Receipt = { id: crypto.randomUUID(), time: performance.timeOrigin + performance.now() };
        // Fully check the metadata write before starting any synchronous business mutations.
        await request(store.put(receipt, 'published'));
        let published = false;
        work(() => { localStorage.setItem(receiptKey, receipt.id); published = true; });
        if (!published) {
          // A validation or storage failure already reported by the form made no commit.
          if (previous) await request(store.put(previous, 'published'));
          else await request(store.delete('published'));
        }
        return true;
      });
      if (completed) return;
      if (performance.now() >= deadline) throw new AiConfigConflict('尚未同步的配置');
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  } finally { db.close(); }
}
