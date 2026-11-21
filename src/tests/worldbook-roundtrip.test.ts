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

describe('无损导出：宽松导入的原始字段形态（独立审查 P2-1）', () => {
  /** 每次返回新对象。条目 0 用数字字符串，条目 1 用 0 / 1 表示真假，条目 2 用 null，条目 3 几乎什么都没写。 */
  const looseBook = () => ({
    name: '宽松写法',
    extra: null,
    entries: {
      '0': { uid: 0, key: ['码头'], content: '甲', order: '50', depth: '6', probability: '35', position: '1', selectiveLogic: '2', scanDepth: '3', sticky: '2', groupWeight: '80' },
      '1': { uid: 1, key: ['港口'], content: '乙', constant: 1, selective: 0, disable: 0, caseSensitive: 1, useProbability: 0, groupOverride: 1, ignoreBudget: 0 },
      '2': { uid: null, key: ['茶楼'], content: '丙', comment: null, order: null, depth: null, scanDepth: null, group: null, sticky: null, extensions: null, customNull: null, customObject: { list: [1, null] } },
      '3': { key: ['夜市'], content: '丁' },
    },
  });
  const pick = (value: Record<string, unknown>, key: string) => (value.entries as Record<string, Record<string, unknown>>)[key];

  it('数字字符串导入后不编辑直接导出：字段仍是原来的字符串', async () => {
    const release = await ok(looseBook());
    expect(release.entries.find((e) => e.sourceKey === '0')!.order).toBe(50); // 内部运行用规范化后的数字
    const { value } = exportSillyTavern(release);
    expect(pick(value, '0')).toEqual(looseBook().entries['0']);
  });

  it('0 / 1 表示的真假导入后直接导出：仍是 0 / 1', async () => {
    const release = await ok(looseBook());
    expect(release.entries.find((e) => e.sourceKey === '1')!.constant).toBe(true);
    const { value } = exportSillyTavern(release);
    expect(pick(value, '1')).toEqual(looseBook().entries['1']);
  });

  it('null、缺失字段、未知字段原样保留；整本文件逐字段一致', async () => {
    const { value } = exportSillyTavern(await ok(looseBook()));
    expect(pick(value, '2')).toEqual(looseBook().entries['2']);
    expect(Object.keys(pick(value, '3')).sort()).toEqual(['content', 'key']);
    expect(canonicalJson(value)).toBe(canonicalJson(looseBook()));
  });

  it('只编辑一个字段：该字段写出新值，其余未编辑字段保持原来的写法', async () => {
    const release = await ok(looseBook());
    const edited: WorldbookRelease = {
      ...release,
      entries: release.entries.map((e) => e.sourceKey === '0' ? { ...e, content: '改过的甲', order: 60 }
        : e.sourceKey === '1' ? { ...e, constant: false } : e.sourceKey === '2' ? { ...e, depth: 9 } : e),
    };
    const { value } = exportSillyTavern(edited);
    expect(pick(value, '0')).toEqual({ ...looseBook().entries['0'], content: '改过的甲', order: 60 });
    expect(pick(value, '1')).toEqual({ ...looseBook().entries['1'], constant: false });
    expect(pick(value, '2')).toEqual({ ...looseBook().entries['2'], depth: 9 });
    expect(pick(value, '3')).toEqual(looseBook().entries['3']);
  });

  it('数组形式同样保持原写法', async () => {
    const book = { entries: Object.values(looseBook().entries) };
    const { value } = exportSillyTavern(await ok(book));
    expect(canonicalJson(value)).toBe(canonicalJson({ entries: Object.values(looseBook().entries) }));
  });

  it('导出结果再导入：规范化条目不变', async () => {
    const first = await ok(looseBook());
    const second = await ok(exportSillyTavern(first).value);
    expect(second.entries).toEqual(first.entries);
  });
});
