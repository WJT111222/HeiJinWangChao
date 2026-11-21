import { describe, expect, it } from 'vitest';
import { importWorldbookText, importWorldbookValue } from '../domain/worldbook/importWorldbook';
import type { WorldbookImportResult, WorldbookRelease } from '../domain/worldbook/schema';
import { characterCardV2, fullSillyTavernEntry, looseSillyTavernBook, sillyTavernArrayBook, sillyTavernDictBook } from './fixtures/worldbooks';

let counter = 0;
const newId = () => `id-${++counter}`;
async function ok(value: unknown, options = {}): Promise<WorldbookRelease> {
  const result = await importWorldbookValue(value, { newId, ...options });
  if (!result.ok) throw new Error(`导入失败：${JSON.stringify(result.notices)}`);
  return result.release;
}
async function failed(value: unknown) {
  const result: WorldbookImportResult = await importWorldbookValue(value, { newId });
  expect(result.ok).toBe(false);
  return result.notices;
}
const codes = (release: WorldbookRelease) => release.compatibility.map((n) => n.code);

describe('酒馆世界书导入', () => {
  it('每个字段都非默认值的条目逐字段对应，保留字段进 inert，扩展原样保留', async () => {
    const release = await ok(sillyTavernDictBook());
    const entry = release.entries[0];
    expect(entry).toEqual({
      entryId: '0', sourceUid: 0, sourceKey: '0',
      comment: '码头', content: '{{user}}常去的码头，入夜后由搬运帮把守。',
      keys: ['码头', '/港口\\d+号/i'], secondaryKeys: ['夜里'],
      selective: false, selectiveLogic: 3, constant: true, disabled: true, order: 250,
      position: 4, depth: 6, role: 2, outletName: 'harbor',
      probability: 35, useProbability: false,
      group: '码头,夜景', groupOverride: true, groupWeight: 55, useGroupScoring: true,
      scanDepth: 7, caseSensitive: true, matchWholeWords: false,
      excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 2,
      sticky: 3, cooldown: 4, delay: 5, ignoreBudget: true, triggers: ['normal', 'swipe'],
      inert: {
        vectorized: true, addMemo: true, matchPersonaDescription: true, matchCharacterDescription: true,
        matchCharacterPersonality: true, matchCharacterDepthPrompt: true, matchScenario: true, matchCreatorNotes: true,
        automationId: 'auto-1', characterFilter: { isExclude: true, names: ['阿青'], tags: [] }, displayIndex: 9,
      },
      extensions: { custom: { nested: [1, 2] } },
    });
    expect(release.source).toEqual({ format: 'sillytavern', payload: sillyTavernDictBook() });
    expect(release.metadata).toEqual({ title: '江城夜话', description: '测试用虚构城市设定' });
    expect(release.origin).toBe('local');
    expect(release.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('缺省字段取参照版本默认值，“跟随全局”的字段保持 null', async () => {
    const entry = (await ok(sillyTavernDictBook())).entries.find((e) => e.entryId === '5')!;
    expect(entry).toMatchObject({
      keys: ['李四'], secondaryKeys: [], comment: '', selective: true, selectiveLogic: 0, constant: false, disabled: false,
      order: 100, position: 0, depth: 4, role: 0, probability: 100, useProbability: true, groupWeight: 100,
      delayUntilRecursion: 0, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
      sticky: null, cooldown: null, delay: null, triggers: [], inert: {}, extensions: {},
    });
  });

  it('兼容提示覆盖正则、无关键词、不生效设置、宏和未知字段', async () => {
    const release = await ok(sillyTavernDictBook());
    for (const code of ['regex_unsupported', 'regex_sticky_flag', 'regex_invalid', 'never_triggers', 'position_unmapped',
      'trigger_unmapped', 'character_filter_inert', 'match_source_inert', 'vectorized_inert', 'automation_ignored',
      'macro_preserved', 'unknown_fields_preserved']) expect(codes(release)).toContain(code);
    const never = release.compatibility.find((n) => n.code === 'never_triggers')!;
    expect(never.entryRef).toBe('7');
    // 非常驻、无关键词的条目保持原样，不会被改成常驻。
    expect(release.entries.find((e) => e.entryId === '7')).toMatchObject({ constant: false, keys: [] });
    expect(release.compatibility.find((n) => n.code === 'unknown_fields_preserved')!.message).toContain('customFlag');
  });

  it('正则关键词原样保留：不拆分、不转义；无效正则按普通文本处理，不支持的写法明确提示', async () => {
    const entry = (await ok(sillyTavernDictBook())).entries.find((e) => e.entryId === '1')!;
    expect(entry.keys).toEqual(['/a(b+)+c/', '/渡口/y', '/(码)\\1/', '/a/b/', '张三']);
    const release = await ok(sillyTavernDictBook());
    // 嵌套重复在安全子集内（线性时间匹配），不报不支持；反向引用不在子集内。
    expect(release.compatibility.filter((n) => n.code === 'regex_unsupported').map((n) => n.message)).toEqual([
      expect.stringContaining('/(码)\\1/'),
    ]);
  });

  it('entries 为数组时与对象形式得到相同条目（只有 sourceKey 不同）', async () => {
    const dict = await ok(sillyTavernDictBook());
    const list = await ok(sillyTavernArrayBook());
    const strip = (r: WorldbookRelease) => r.entries.map((e) => ({ ...e, sourceKey: null }));
    expect(strip(list)).toEqual(strip(dict));
    expect(list.entries.map((e) => e.sourceKey)).toEqual(['0', '1', '2', '3']);
  });

  it('数字字符串和 0/1 按宽松读法转换并记警告', async () => {
    const release = await ok(looseSillyTavernBook());
    expect(release.entries[0]).toMatchObject({ order: 12, probability: 40, disabled: true, constant: false });
    expect(release.compatibility.filter((n) => n.code === 'value_coerced').map((n) => n.field)).toEqual(['constant', 'order', 'disable', 'probability']);
  });

  it('重复 uid 两条都保留并区分；对象形式缺 uid 时用键作身份', async () => {
    const release = await ok({ entries: { a: { uid: 3, key: ['甲'] }, b: { uid: 3, key: ['乙'] }, c: { key: ['丙'] } } });
    expect(release.entries.map((e) => [e.entryId, e.sourceUid])).toEqual([['3', 3], ['3~2', 3], ['c', null]]);
    expect(release.compatibility.find((n) => n.code === 'duplicate_uid')).toMatchObject({ entryRef: 'b', field: 'uid' });
  });

  it('书名优先级：玩家指定 → 文件内名字 → 文件名 → 默认', async () => {
    expect((await ok(sillyTavernDictBook(), { title: ' 我的书 ' })).metadata.title).toBe('我的书');
    expect((await ok({ entries: {} }, { fileName: 'C:\\下载\\港口.json' })).metadata.title).toBe('港口');
    expect((await ok({ entries: {} })).metadata.title).toBe('未命名世界书');
  });

  it('字段类型错误：整本不导入，错误可定位到条目和字段', async () => {
    const notices = await failed({ entries: { 4: { uid: 4, key: '码头,港口', content: 1, selective: 'true' } } });
    expect(notices.filter((n) => n.code === 'field_type').map((n) => [n.entryRef, n.field])).toEqual([['4', 'key'], ['4', 'content'], ['4', 'selective']]);
  });
});

describe('角色卡 V2 导入', () => {
  it('按参照版本的换算规则：extensions 优先、selective 缺省为假、enabled 取反', async () => {
    const release = await ok(characterCardV2());
    expect(release.source.format).toBe('character-card-v2');
    expect(release.metadata).toEqual({ title: '阿青的世界书', description: '茶馆一带的设定' });
    const [tea, dock, ferry] = release.entries;
    expect(tea).toMatchObject({
      entryId: '12', sourceUid: 12, sourceKey: '0', keys: ['茶馆'], secondaryKeys: ['白天'], selective: true,
      order: 10, position: 4, depth: 2, groupWeight: 30, probability: 60, sticky: 2, matchWholeWords: true,
      disabled: false, comment: '茶馆', caseSensitive: null,
      inert: { addMemo: true, displayIndex: 0, vectorized: false, automationId: '' },
    });
    expect(tea.extensions).toEqual({ position: 4, depth: 2, group_weight: 30, probability: 60, sticky: 2, match_whole_words: true, vendorField: 'x' });
    expect(dock).toMatchObject({ entryId: '1', selective: false, position: 1, disabled: true, inert: { addMemo: false } });
    expect(ferry).toMatchObject({ entryId: '2', disabled: true, position: 1, order: 1 });
  });

  it('只保存 character_book；角色卡其余内容不导入，未用字段与缺失字段都有说明', async () => {
    const release = await ok(characterCardV2());
    expect(release.source.payload).toEqual(characterCardV2().data.character_book);
    expect(JSON.stringify(release)).not.toContain('角色描述，不应导入');
    expect(codes(release)).toContain('card_content_skipped');
    expect(release.compatibility.find((n) => n.code === 'book_setting_unused')!.message).toContain('scan_depth、token_budget、recursive_scanning');
    expect(release.compatibility.find((n) => n.code === 'entry_field_unused')!.message).toContain('case_sensitive');
    expect(release.compatibility.find((n) => n.code === 'missing_required' && n.field === 'enabled')).toMatchObject({ entryRef: '2' });
    expect(release.compatibility.find((n) => n.code === 'unknown_fields_preserved')!.message).toContain('futureField');
  });

  it('单独的 character_book（entries 为数组且用 keys）也能识别', async () => {
    const release = await ok(characterCardV2().data.character_book);
    expect(release.source.format).toBe('character-card-v2');
    expect(release.entries).toHaveLength(3);
    expect(codes(release)).not.toContain('card_content_skipped');
  });
});

describe('格式识别与文件级错误', () => {
  it('不支持的格式明确报错', async () => {
    const cases: [unknown, string][] = [
      [{ spec: 'chara_card_v3', data: { character_book: { entries: [] } } }, '角色卡 V3'],
      [{ lorebookVersion: 5, entries: [] }, 'NovelAI'],
      [{ kind: 'memory', entries: [] }, 'Agnai'],
      [{ type: 'risu', data: [] }, 'RisuAI'],
    ];
    for (const [value, name] of cases) {
      const notices = await failed(value);
      expect(notices[0].code).toBe('unsupported_format');
      expect(notices[0].message).toContain(name);
    }
    expect((await importWorldbookText('\u0089PNG\r\n\u001a\n...')).notices[0].message).toContain('PNG');
  });

  it('无法识别、不是对象、不是 JSON 都安全失败', async () => {
    expect((await failed({ hello: 1 }))[0].code).toBe('unknown_format');
    expect((await failed([1, 2]))[0].code).toBe('invalid_root');
    const broken = await importWorldbookText('{"entries": {');
    expect(broken.ok).toBe(false);
    expect(broken.notices[0].code).toBe('invalid_json');
  });

  it('带 BOM 的文本也能导入', async () => {
    const result = await importWorldbookText(`\ufeff${JSON.stringify({ entries: { 0: fullSillyTavernEntry() } })}`, { newId });
    expect(result.ok).toBe(true);
  });
});
