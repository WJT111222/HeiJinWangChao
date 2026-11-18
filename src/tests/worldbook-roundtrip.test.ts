import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash } from '../domain/worldbook/canonical';
import { exportNativeText, exportSillyTavern } from '../domain/worldbook/export';
import { importWorldbookText, importWorldbookValue } from '../domain/worldbook/importWorldbook';
import type { WorldbookRelease } from '../domain/worldbook/schema';
import { characterCardV2, sillyTavernArrayBook, sillyTavernDictBook } from './fixtures/worldbooks';

let counter = 0;
const newId = () => `rt-${++counter}`;
async function ok(value: unknown): Promise<WorldbookRelease> {
  const result = await importWorldbookValue(value, { newId });
  if (!result.ok) throw new Error(JSON.stringify(result.notices));
  return result.release;
}
const withoutSourceKey = (release: WorldbookRelease) => release.entries.map((e) => ({ ...e, sourceKey: null }));

describe('酒馆格式回环', () => {
  it('对象形式：导出与原文件完全一致（缺省字段不会凭空增加，未知字段原样带回）', async () => {
    const release = await ok(sillyTavernDictBook());
    const { value, notices } = exportSillyTavern(release);
    expect(canonicalJson(value)).toBe(canonicalJson(sillyTavernDictBook()));
    expect(notices).toEqual([]);
  });

  it('数组形式：导出仍为数组且与原文件一致', async () => {
    const { value } = exportSillyTavern(await ok(sillyTavernArrayBook()));
    expect(Array.isArray(value.entries)).toBe(true);
    expect(canonicalJson(value)).toBe(canonicalJson(sillyTavernArrayBook()));
  });

  it('导出再导入：规范化条目、元信息和内容哈希都不变', async () => {
    const first = await ok(sillyTavernDictBook());
    const second = await ok(exportSillyTavern(first).value);
    expect(second.entries).toEqual(first.entries);
    expect(second.metadata).toEqual(first.metadata);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.bookId).not.toBe(first.bookId); // 酒馆文件不带王朝身份，每次导入都是新书
  });
});

describe('王朝格式回环', () => {
  it('导出再导入得到完全相同的版本（身份、哈希、条目、来源）', async () => {
    const release = await ok(sillyTavernDictBook());
    const back = await importWorldbookText(exportNativeText(release));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect({ ...back.release, compatibility: [] }).toEqual({ ...release, compatibility: [] });
  });

  it('改动任何一个字都会因哈希对不上而被拒绝', async () => {
    const release = await ok(sillyTavernDictBook());
    const tampered = exportNativeText(release).replace('李四是茶楼老板。', '李四是码头老板。');
    const result = await importWorldbookText(tampered);
    expect(result.ok).toBe(false);
    expect(result.notices.map((n) => n.code)).toContain('hash_mismatch');
  });

  it('文件自称官方无效：导入后来源为 local 并说明', async () => {
    const release = await ok(sillyTavernDictBook());
    const claimed = JSON.parse(exportNativeText(release));
    claimed.origin = 'official';
    const result = await importWorldbookValue(claimed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.release.origin).toBe('local');
    expect(result.notices.map((n) => n.code)).toContain('origin_ignored');
  });

  it('结构不对或条目 ID 重复时拒绝', async () => {
    const release = await ok(sillyTavernDictBook());
    const broken = { ...JSON.parse(exportNativeText(release)), bookId: '含 空格' };
    expect((await importWorldbookValue(broken)).notices[0].code).toBe('native_invalid');
    const dup = JSON.parse(exportNativeText(release));
    dup.entries[1].entryId = dup.entries[0].entryId;
    dup.contentHash = await contentHash(dup);
    expect((await importWorldbookValue(dup)).notices.map((n) => n.code)).toContain('duplicate_entry_id');
  });
});

describe('角色卡 V2 → 酒馆格式', () => {
  it('按完整字段写出，再导入后条目一致；角色卡专有字段说明会丢失', async () => {
    const card = await ok(characterCardV2());
    const { value, notices } = exportSillyTavern(card);
    expect(Object.keys(value.entries as object)).toEqual(['1', '2', '12']);
    expect(notices[0].code).toBe('export_lossy');
    expect(notices[0].message).toContain('scan_depth');
    expect(notices[0].message).toContain('条目 priority');
    const back = await ok(value);
    const byId = (r: WorldbookRelease) => withoutSourceKey(r).sort((a, b) => a.entryId.localeCompare(b.entryId));
    expect(byId(back)).toEqual(byId(card));
  });
});

describe('确定性哈希与特殊键', () => {
  it('键顺序不同的同一内容得到同一个确定性 JSON', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(canonicalJson({ a: 1, skip: undefined })).toBe('{"a":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });

  it('"__proto__" 作为普通字段在导入、两种导出中都保留', async () => {
    const text = '{"entries":{"0":{"uid":0,"key":["甲"],"__proto__":{"polluted":true},"extensions":{"__proto__":{"x":1}}}}}';
    const imported = await importWorldbookText(text, { newId });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const entry = imported.release.entries[0];
    expect(Object.hasOwn(entry.extensions, '__proto__')).toBe(true);
    const st = exportSillyTavern(imported.release).value;
    expect(canonicalJson(st)).toBe(canonicalJson(JSON.parse(text)));
    const native = await importWorldbookText(exportNativeText(imported.release));
    expect(native.ok).toBe(true);
    if (native.ok) expect(native.release.contentHash).toBe(imported.release.contentHash);
  });
});
