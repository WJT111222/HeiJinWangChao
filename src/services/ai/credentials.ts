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
    other.removeItem(keyFor(id));
    target.setItem(keyFor(id), key.trim());
  }
  delete(id: string) {
    this.session.removeItem(keyFor(id));
    this.persistent.removeItem(keyFor(id));
  }
  /** 记下这些渠道当前在两处存储里的原始值，供保存失败时原样恢复（只在内存中短暂持有，不记录、不输出）。 */
  snapshot(ids: Iterable<string>): VaultSnapshot {
    return [...new Set(ids)].map((id) => ({ id, session: this.session.getItem(keyFor(id)), persistent: this.persistent.getItem(keyFor(id)) }));
  }
  /** 恢复快照：先移除本次写入的值腾出空间，再写回原值；尽量恢复每一项，不因单项失败中断。 */
  restore(snapshot: VaultSnapshot) {
    for (const entry of snapshot) {
      for (const store of [this.session, this.persistent]) {
        try { store.removeItem(keyFor(entry.id)); } catch { /* 继续恢复其他项 */ }
      }
    }
    for (const entry of snapshot) {
      for (const [store, value] of [[this.session, entry.session], [this.persistent, entry.persistent]] as const) {
        if (value === null) continue;
        try { store.setItem(keyFor(entry.id), value); } catch { /* 继续恢复其他项 */ }
      }
    }
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
