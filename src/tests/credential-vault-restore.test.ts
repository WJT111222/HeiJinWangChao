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

const credential = (id: string) => `heijin.credential.v1:${id}`;
it('持续写入失败：已经与快照一致的旧密钥不删除、不重写', () => {
  const session = store(), persistent = store();
  persistent.data.set(credential('a'), 'old-a');
  const operations: string[] = [];
  const blocked = { getItem: persistent.getItem,
    setItem: () => { operations.push('set'); throw new DOMException('blocked', 'QuotaExceededError'); },
    removeItem: (key: string) => { operations.push('remove'); persistent.removeItem(key); } };
  const vault = new CredentialVault(session, blocked), snapshot = vault.snapshot(['a']);
  expect(() => vault.set('a', 'new-a', true)).toThrow();
  operations.length = 0;
  expect(vault.restore(snapshot)).toEqual({ restored: true, failedIds: [] });
  expect(operations).toEqual([]);
  expect(persistent.getItem(credential('a'))).toBe('old-a');
});

it('三渠道部分写入后持续失败：尽力恢复其他渠道，准确报告无法恢复的渠道', () => {
  const session = store(), persistent = store();
  let blocked = false;
  const local = { ...persistent, setItem: (key: string, value: string) => {
    if (blocked && [credential('a'), credential('b')].includes(key)) throw new DOMException('blocked', 'QuotaExceededError');
    persistent.setItem(key, value);
  } };
  const vault = new CredentialVault(session, local);
  vault.set('a', 'old-a', true); vault.set('b', 'old-b'); vault.set('c', 'old-c', true);
  const snapshot = vault.snapshot(['a', 'b', 'c']);
  vault.delete('c'); vault.set('a', 'new-a', true); blocked = true;
  expect(() => vault.set('b', 'new-b', true)).toThrow();
  const result = vault.restore(snapshot);
  expect(result).toEqual({ restored: false, failedIds: ['a'] });
  expect(persistent.getItem(credential('a'))).toBe('new-a');
  expect(session.getItem(credential('b'))).toBe('old-b');
  expect(persistent.getItem(credential('b'))).toBeNull();
  expect(persistent.getItem(credential('c'))).toBe('old-c');
  expect(JSON.stringify(result)).not.toMatch(/old-|new-/);
});

it('恢复迁移时先写回原存储，成功后才删除多余副本', () => {
  const session = store(), persistent = store(), vault = new CredentialVault(session, persistent);
  vault.set('a', 'old-a');
  const snapshot = vault.snapshot(['a']); vault.set('a', 'old-a', true);
  const checkedLocal = { ...persistent, removeItem: (key: string) => {
    expect(session.getItem(key)).toBe('old-a'); persistent.removeItem(key);
  } };
  expect(new CredentialVault(session, checkedLocal).restore(snapshot)).toEqual({ restored: true, failedIds: [] });
  expect(session.getItem(credential('a'))).toBe('old-a');
  expect(persistent.getItem(credential('a'))).toBeNull();
});

it('原位置持续拒写时保留尚存副本，不为清理而造成额外丢失', () => {
  const session = store(), persistent = store(), vault = new CredentialVault(session, persistent);
  vault.set('a', 'old-a'); const snapshot = vault.snapshot(['a']); vault.set('a', 'old-a', true);
  const blockedSession = { ...session, setItem: () => { throw new DOMException('blocked', 'QuotaExceededError'); } };
  expect(new CredentialVault(blockedSession, persistent).restore(snapshot)).toEqual({ restored: false, failedIds: ['a'] });
  expect(persistent.getItem(credential('a'))).toBe('old-a');
  expect(session.getItem(credential('a'))).toBeNull();
});

it('持续删除失败：不覆盖原副本，额外副本无法清理时明确失败', () => {
  const session = store(), persistent = store(), vault = new CredentialVault(session, persistent);
  vault.set('a', 'old-a'); const snapshot = vault.snapshot(['a']); persistent.data.set(credential('a'), 'extra-a');
  const blockedSession = { ...session, setItem: () => { throw new Error('unchanged original must not be rewritten'); } };
  const blockedLocal = { ...persistent, removeItem: () => { throw new DOMException('blocked', 'SecurityError'); } };
  expect(new CredentialVault(blockedSession, blockedLocal).restore(snapshot)).toEqual({ restored: false, failedIds: ['a'] });
  expect(session.getItem(credential('a'))).toBe('old-a'); expect(persistent.getItem(credential('a'))).toBe('extra-a');
});

it('最终核验读取失败不能被报告为恢复成功', () => {
  const session = store(), persistent = store(); persistent.data.set(credential('a'), 'old-a');
  const snapshot = new CredentialVault(session, persistent).snapshot(['a']);
  const unreadable = { ...persistent, getItem: () => { throw new DOMException('blocked', 'SecurityError'); } };
  expect(new CredentialVault(session, unreadable).restore(snapshot)).toEqual({ restored: false, failedIds: ['a'] });
  expect(persistent.getItem(credential('a'))).toBe('old-a');
});

it('快照读取失败不执行任何存储写入或删除', () => {
  const mutations: string[] = [];
  const unreadable = { getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    setItem: () => { mutations.push('set'); }, removeItem: () => { mutations.push('remove'); } };
  expect(() => new CredentialVault(unreadable, store()).snapshot(['a'])).toThrow(); expect(mutations).toEqual([]);
});

it('正常迁移目标持续拒写时保留原始存储的旧密钥', () => {
  const session = store(), persistent = store(); session.data.set(credential('a'), 'old-a');
  const blocked = { ...persistent, setItem: () => { throw new DOMException('blocked', 'QuotaExceededError'); } };
  expect(() => new CredentialVault(session, blocked).set('a', 'new-a', true)).toThrow();
  expect(session.getItem(credential('a'))).toBe('old-a'); expect(persistent.getItem(credential('a'))).toBeNull();
});

it('写入持续失败（删除正常）：旧密钥不会因回滚被删掉，恢复结果为成功', () => {
  const session = store(), persistent = store();
  persistent.data.set('heijin.credential.v1:a', 'old-key');
  persistent.setItem = () => { throw new DOMException('mock', 'QuotaExceededError'); };
  session.setItem = () => { throw new DOMException('mock', 'QuotaExceededError'); };
  const vault = new CredentialVault(session, persistent);
  const snapshot = vault.snapshot(['a']);
  expect(() => vault.set('a', 'new-key', true)).toThrow();
  expect(vault.restore(snapshot).restored).toBe(true);
  expect(persistent.data.get('heijin.credential.v1:a')).toBe('old-key');
  // 换存放位置时也一样：写新位置失败，旧位置的密钥原封不动。
  expect(() => vault.set('a', 'new-key', false)).toThrow();
  expect(vault.restore(snapshot).restored).toBe(true);
  expect(persistent.data.get('heijin.credential.v1:a')).toBe('old-key');
  expect(session.data.has('heijin.credential.v1:a')).toBe(false);
});

it('原值确实写不回去时如实返回失败，并保留现有副本而不是删光', () => {
  const session = store(), persistent = store();
  const vault = new CredentialVault(session, persistent);
  vault.set('a', 'old-key', true);
  const snapshot = vault.snapshot(['a']);
  vault.set('a', 'new-key', false); // 已移到本次会话
  persistent.setItem = () => { throw new DOMException('mock', 'QuotaExceededError'); };
  expect(vault.restore(snapshot).restored).toBe(false);
  expect(session.data.get('heijin.credential.v1:a')).toBe('new-key');
});

it('已经和快照一致的项不重复写入或删除', () => {
  const session = store(), persistent = store();
  const vault = new CredentialVault(session, persistent);
  vault.set('a', 'key-a', true); vault.set('b', 'key-b', false);
  const snapshot = vault.snapshot(['a', 'b']);
  let writes = 0, removes = 0;
  for (const target of [session, persistent]) {
    const set = target.setItem, remove = target.removeItem;
    target.setItem = (key, value) => { writes++; set(key, value); };
    target.removeItem = (key) => { removes++; remove(key); };
  }
  expect(vault.restore(snapshot).restored).toBe(true);
  expect({ writes, removes }).toEqual({ writes: 0, removes: 0 });
});

it('其他渠道释放空间后重试原副本，仍先恢复再清理唯一备份', () => {
  const session = store(), persistent = store(), vault = new CredentialVault(session, persistent);
  vault.set('a', 'old-a'); const snapshot = vault.snapshot(['a', 'temporary']);
  vault.set('a', 'old-a', true); session.data.set(credential('temporary'), 'fills-session-space');
  const quotaSession = { ...session, setItem: (key: string, value: string) => {
    if (session.data.has(credential('temporary'))) throw new DOMException('full', 'QuotaExceededError');
    session.setItem(key, value);
  } };
  expect(new CredentialVault(quotaSession, persistent).restore(snapshot)).toEqual({ restored: true, failedIds: [] });
  expect(session.getItem(credential('a'))).toBe('old-a'); expect(persistent.getItem(credential('a'))).toBeNull();
  expect(session.getItem(credential('temporary'))).toBeNull();
});
