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
    target.setItem(keyFor(id), key.trim());
    // 先确认目标写入成功，再移除原副本；持续拒写不能先丢掉仍可用的旧密钥。
    if (other !== target) other.removeItem(keyFor(id));
  }
  delete(id: string) {
    this.session.removeItem(keyFor(id));
    this.persistent.removeItem(keyFor(id));
  }
  /** 记下这些渠道当前在两处存储里的原始值，供保存失败时原样恢复（只在内存中短暂持有，不记录、不输出）。 */
  snapshot(ids: Iterable<string>): VaultSnapshot {
    return [...new Set(ids)].map((id) => ({ id, session: this.session.getItem(keyFor(id)), persistent: this.persistent.getItem(keyFor(id)) }));
  }
  /** 尽力恢复原值/位置，一致项不写；原副本恢复后才清理额外副本。结果不包含凭证值。 */
  restore(snapshot: VaultSnapshot): VaultRestoreResult {
    const places = (entry: VaultSnapshot[number]) => [[this.session, entry.session], [this.persistent, entry.persistent]] as const;
    const read = (store: Store, id: string) => { try { return store.getItem(keyFor(id)); } catch { return undefined; } };
    const writeOriginals = (entry: VaultSnapshot[number]) => {
      let ready = true;
      // 单个位置失败也继续恢复另一位置；无法读取时不盲目重写已有副本。
      for (const [store, value] of places(entry)) {
        if (value === null) continue;
        const current = read(store, entry.id);
        if (current === value) continue;
        if (current === undefined) { ready = false; continue; }
        try { store.setItem(keyFor(entry.id), value); } catch { /* 最终核验决定结果。 */ }
        if (read(store, entry.id) !== value) ready = false;
      }
      return ready;
    };
    const removeExtras = (entry: VaultSnapshot[number]) => {
      for (const [store, value] of places(entry)) {
        if (value !== null) continue;
        const current = read(store, entry.id);
        if (current === undefined || current === null) continue;
        try { store.removeItem(keyFor(entry.id)); } catch { /* 多余副本也会在最终核验中报告。 */ }
      }
    };
    const pending: VaultSnapshot = [];
    for (const entry of snapshot) {
      if (writeOriginals(entry)) removeExtras(entry); else pending.push(entry);
    }
    // 其他渠道清理成功后若腾出容量，再尝试一次原副本。
    for (const entry of pending) if (writeOriginals(entry)) removeExtras(entry);
    const failedIds = snapshot.filter(entry => places(entry).map(([store, value]) => read(store, entry.id) === value)
      .some(matches => !matches)).map(entry => entry.id);
    return { restored: failedIds.length === 0, failedIds };
  }
}
export type VaultSnapshot = { id: string; session: string | null; persistent: string | null }[];
export type VaultRestoreResult = { restored: boolean; failedIds: string[] };

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
