import { expect, it } from 'vitest';
import { CredentialVault } from '../services/ai/credentials';

// 内存存储：可以指定第几次 setItem / removeItem 失败，用来模拟浏览器存储空间不足或权限问题。
function store(failSetOn = 0, failRemoveOn = 0) {
  const data = new Map<string, string>();
  let sets = 0, removes = 0;
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { sets++; if (sets === failSetOn) throw new DOMException('mock', 'QuotaExceededError'); data.set(key, value); },
    removeItem: (key: string) => { removes++; if (removes === failRemoveOn) throw new DOMException('mock', 'SecurityError'); data.delete(key); },
  };
}

it('快照与恢复：密钥值和存放位置（本次会话 / 长期记住）都原样回来', () => {
  const session = store(), persistent = store();
  const vault = new CredentialVault(session, persistent);
  vault.set('a', 'key-a', true); vault.set('b', 'key-b', false); vault.set('c', 'key-c', true);
  const before = { session: [...session.data], persistent: [...persistent.data] };
  const snapshot = vault.snapshot(['a', 'b', 'c', 'new']);
  vault.set('a', 'changed-a', false); vault.set('b', 'key-b', true); vault.delete('c'); vault.set('new', 'key-new', true);
  vault.restore(snapshot);
  expect({ session: [...session.data].sort(), persistent: [...persistent.data].sort() }).toEqual({ session: before.session.sort(), persistent: before.persistent.sort() });
});

it('写到一半失败后恢复：已写入的部分撤回，未涉及的渠道不受影响', () => {
  const session = store(), persistent = store();
  const vault = new CredentialVault(session, persistent);
  vault.set('a', 'key-a', false); vault.set('b', 'key-b', false); vault.set('other', 'key-other', true);
  const before = { session: [...session.data].sort(), persistent: [...persistent.data].sort() };
  const failing = store(), failingPersistent = store(2);
  for (const [key, value] of session.data) failing.data.set(key, value);
  for (const [key, value] of persistent.data) failingPersistent.data.set(key, value);
  const tx = new CredentialVault(failing, failingPersistent);
  const snapshot = tx.snapshot(['a', 'b']);
  expect(() => { tx.set('a', 'key-a', true); tx.set('b', 'key-b', true); }).toThrow();
  tx.restore(snapshot);
  expect({ session: [...failing.data].sort(), persistent: [...failingPersistent.data].sort() }).toEqual(before);
});

it('删除失败后恢复：两处存储里的原值都在', () => {
  const session = store(), persistent = store(0, 1);
  const vault = new CredentialVault(session, persistent);
  vault.set('a', 'key-a', true); session.data.set('heijin.credential.v1:a', 'key-a-session');
  const snapshot = vault.snapshot(['a']);
  expect(() => vault.delete('a')).toThrow();
  vault.restore(snapshot);
  expect(session.data.get('heijin.credential.v1:a')).toBe('key-a-session');
  expect(persistent.data.get('heijin.credential.v1:a')).toBe('key-a');
});
