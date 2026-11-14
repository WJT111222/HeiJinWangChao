import { readAiConfig } from './configuration';
// 密钥独立于渠道配置、游戏状态及提示词。默认 sessionStorage；长期保留只由显式用户选择触发。
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyFor = (id: string) => `heijin.credential.v1:${id}`;
export class CredentialVault {
  constructor(
    private session: Store,
    private persistent: Store,
  ) {}
  get(id: string) {
    return this.session.getItem(keyFor(id)) ?? this.persistent.getItem(keyFor(id)) ?? '';
  }
  remembered(id: string) {
    return this.persistent.getItem(keyFor(id)) !== null;
  }
  set(id: string, key: string, remember = false) {
    if (!key.trim()) {
      this.delete(id);
      return;
    }
    const target = remember ? this.persistent : this.session;
    const other = remember ? this.session : this.persistent;
    // 先写新位置再删旧位置：写入失败时旧密钥原封不动。
    target.setItem(keyFor(id), key.trim());
    other.removeItem(keyFor(id));
  }
  delete(id: string) {
    this.session.removeItem(keyFor(id));
    this.persistent.removeItem(keyFor(id));
  }
  /** 记下这些渠道当前在两处存储里的原始值，供保存失败时原样恢复（只在内存中短暂持有，不记录、不输出）。 */
  snapshot(ids: Iterable<string>): VaultSnapshot {
    return [...new Set(ids)].map((id) => ({ id, session: this.session.getItem(keyFor(id)), persistent: this.persistent.getItem(keyFor(id)) }));
  }
  /**
   * 恢复快照，返回两处存储是否已与快照完全一致。
   * 只动和快照不一致的项：先把原值写回；某个渠道的原值都已就位后，才清掉不该存在的新副本。
   * 原值写不回去的渠道，保留它现有的副本，避免回滚本身让密钥丢失。
   */
  restore(snapshot: VaultSnapshot): boolean {
    const places = (entry: VaultSnapshot[number]) => [[this.session, entry.session], [this.persistent, entry.persistent]] as const;
    const read = (store: Store, id: string) => { try { return store.getItem(keyFor(id)); } catch { return undefined; } };
    const attempt = (action: () => void) => { try { action(); return true; } catch { return false; } };
    const writeOriginals = (entry: VaultSnapshot[number]) => places(entry).every(([store, value]) =>
      value === null || read(store, entry.id) === value || attempt(() => store.setItem(keyFor(entry.id), value)));
    const removeExtras = (entry: VaultSnapshot[number]) => places(entry).every(([store, value]) =>
      value !== null || read(store, entry.id) === null || attempt(() => store.removeItem(keyFor(entry.id))));
    const pending: VaultSnapshot = [];
    for (const entry of snapshot) {
      if (writeOriginals(entry)) removeExtras(entry); else pending.push(entry);
    }
    // 空间不足时，前面清掉新副本可能腾出了位置，再试一次写回原值。
    for (const entry of pending) if (writeOriginals(entry)) removeExtras(entry);
    return snapshot.every((entry) => places(entry).every(([store, value]) => read(store, entry.id) === value));
  }
}
export type VaultSnapshot = { id: string; session: string | null; persistent: string | null }[];

// 只供脱敏使用；不向查看器返回凭证，也不持久化调试内容。
export function browserCredentials(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const config = readAiConfig(window.localStorage);
    const vault = new CredentialVault(window.sessionStorage, window.localStorage);
    return config.channels.map((channel) => vault.get(channel.id)).filter(Boolean);
  } catch {
    return [];
  }
}
