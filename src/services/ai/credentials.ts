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
    for (const entry of snapshot) {
      for (const [store, value] of [[this.session, entry.session], [this.persistent, entry.persistent]] as const) {
        if (value === null) continue;
        try {
          if (store.getItem(keyFor(entry.id)) !== value) store.setItem(keyFor(entry.id), value);
        } catch { /* 保留现有副本，继续恢复其他位置与渠道，最后统一核验。 */ }
      }
    }
    for (const entry of snapshot) {
      // 不能恢复原位置时，宁可保留现有副本并明确报错，也不先将它删除。
      try {
        if (entry.session !== null && this.session.getItem(keyFor(entry.id)) !== entry.session) continue;
        if (entry.persistent !== null && this.persistent.getItem(keyFor(entry.id)) !== entry.persistent) continue;
      } catch { continue; }
      for (const [store, value] of [[this.session, entry.session], [this.persistent, entry.persistent]] as const) {
        if (value !== null) continue;
        try {
          if (store.getItem(keyFor(entry.id)) !== null) store.removeItem(keyFor(entry.id));
        } catch { /* 继续核验其他渠道；多余副本也算未恢复。 */ }
      }
    }
    const failedIds = snapshot.filter((entry) => {
      try {
        const session = this.session.getItem(keyFor(entry.id)), persistent = this.persistent.getItem(keyFor(entry.id));
        return session !== entry.session || persistent !== entry.persistent;
      } catch { return true; }
    }).map(entry => entry.id);
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
