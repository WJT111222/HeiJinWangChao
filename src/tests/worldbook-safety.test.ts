import { afterEach, describe, expect, it } from 'vitest';
import { classifyKey, regexRisk } from '../domain/worldbook/regexKey';
import { importWorldbookText, importWorldbookValue, utf8Bytes } from '../domain/worldbook/importWorldbook';
import { WORLDBOOK_LIMITS } from '../domain/worldbook/schema';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('文件大小与结构上限', () => {
  it('UTF-8 字节数计算正确，超过上限后立即停止计数', () => {
    expect(utf8Bytes('a中😀')).toBe(1 + 3 + 4);
    expect(utf8Bytes('中'.repeat(1000), 10)).toBeLessThan(20);
  });

  it('超过体积上限的文件在解析前拒绝', async () => {
    const result = await importWorldbookText('a'.repeat(WORLDBOOK_LIMITS.maxBytes + 1));
    expect(result.ok).toBe(false);
    expect(result.notices[0].code).toBe('too_large');
  });

  it('条目数超过上限时拒绝', async () => {
    const entries = Array.from({ length: WORLDBOOK_LIMITS.maxEntries + 1 }, (_, uid) => ({ uid, key: ['k'] }));
    const result = await importWorldbookValue({ entries });
    expect(result.ok).toBe(false);
    expect(result.notices[0].code).toBe('too_many_entries');
  });

  it('正文超长、关键词过多时整本拒绝并定位', async () => {
    const result = await importWorldbookValue({ entries: {
      0: { uid: 0, key: ['k'], content: '字'.repeat(WORLDBOOK_LIMITS.maxContentChars + 1) },
      1: { uid: 1, key: Array.from({ length: WORLDBOOK_LIMITS.maxKeysPerEntry + 1 }, (_, i) => `k${i}`) },
    } });
    expect(result.ok).toBe(false);
    expect(result.notices.filter((n) => n.level === 'error').map((n) => [n.code, n.entryRef])).toEqual([['content_too_long', '0'], ['too_many_keys', '1']]);
  });

  it('嵌套极深的 JSON 不会让页面崩溃', async () => {
    const result = await importWorldbookText(`${'['.repeat(200_000)}${']'.repeat(200_000)}`);
    expect(result.ok).toBe(false);
  });

  it('条目不是对象、extensions 不是对象、关键词写成逗号字符串都报错，不猜测拆分', async () => {
    const result = await importWorldbookValue({ entries: [null, { uid: 1, key: ['a'], extensions: 'x' }, { uid: 2, key: 'a,b' }] });
    expect(result.ok).toBe(false);
    expect(result.notices.map((n) => [n.code, n.entryRef, n.field ?? ''])).toEqual([
      ['entry_not_object', '0', ''], ['field_type', '1', 'extensions'], ['field_type', '2', 'key'],
    ]);
  });

  it('提示过多时合并，错误永远保留', async () => {
    const entries = Array.from({ length: WORLDBOOK_LIMITS.maxNotices + 50 }, (_, uid) => ({ uid, key: [], content: '{{char}}' }));
    const result = await importWorldbookValue({ entries });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notices.at(-1)!.code).toBe('notices_truncated');
    expect(result.notices.length).toBe(WORLDBOOK_LIMITS.maxNotices + 1);
  });
});

describe('不执行、不联网', () => {
  it('导入过程不发起任何网络请求', async () => {
    let called = 0;
    globalThis.fetch = (() => { called++; throw new Error('不应联网'); }) as typeof fetch;
    const result = await importWorldbookValue({ entries: { 0: { uid: 0, key: ['https://example.com'], content: '<img src="https://example.com/x.png">', automationId: 'run-me' } } });
    expect(result.ok).toBe(true);
    expect(called).toBe(0);
  });

  it('宏、脚本样式文本、自动化 ID 都只是原样保存的字符串', async () => {
    const content = '{{user}} {{random::a,b}} <script>alert(1)</script> /run something';
    const result = await importWorldbookValue({ entries: { 0: { uid: 0, key: ['{{char}}'], content, automationId: 'auto' } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.release.entries[0].content).toBe(content);
    expect(result.release.entries[0].keys).toEqual(['{{char}}']);
    expect(result.release.entries[0].inert.automationId).toBe('auto');
  });

  it('灾难性正则只做静态预检，导入很快完成', async () => {
    const started = Date.now();
    const result = await importWorldbookValue({ entries: { 0: { uid: 0, key: ['/(a+)+$/', '/^(\\w+\\s?)*$/'], content: 'a'.repeat(50) + '!' } } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.release.compatibility.filter((n) => n.code === 'regex_risky')).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('正则关键词分类（与参照版本行为一致）', () => {
  it('分类规则', () => {
    expect(classifyKey('码头')).toEqual({ kind: 'text' });
    expect(classifyKey('/码头/')).toEqual({ kind: 'regex', source: '码头', flags: '' });
    expect(classifyKey('/a\\/b/i')).toEqual({ kind: 'regex', source: 'a/b', flags: 'i' });
    expect(classifyKey('/a\\/b\\/c/')).toEqual({ kind: 'regex', source: 'a/b\\/c', flags: '' }); // 只还原第一处
    expect(classifyKey('/a/b/')).toEqual({ kind: 'invalid-regex' }); // 未转义的斜杠
    expect(classifyKey('/a(/')).toEqual({ kind: 'invalid-regex' }); // 语法错误
    expect(classifyKey('/a/gg')).toEqual({ kind: 'invalid-regex' }); // 标志重复
    expect(classifyKey('/a/x')).toEqual({ kind: 'text' }); // 非法标志：不算正则
    expect(classifyKey('//')).toEqual({ kind: 'text' });
  });

  it('风险预检', () => {
    expect(regexRisk('(a+)+')).toBe('risky');
    expect(regexRisk('(\\w+){2,}')).toBe('risky');
    expect(regexRisk('(a)\\1')).toBe('risky');
    expect(regexRisk('码头\\d+号')).toBeNull();
    expect(regexRisk('a'.repeat(1001))).toBe('too-long');
  });
});
