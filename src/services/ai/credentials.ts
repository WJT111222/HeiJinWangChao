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
}

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
