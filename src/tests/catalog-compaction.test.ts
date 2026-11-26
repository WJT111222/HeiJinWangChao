import { describe, expect, it } from 'vitest';
import { commandCatalog, inlineCommandCatalog } from '../services/validation/commandCatalog';
import { compactWorldCommandSchema, describeTimeFormats, factorRepeatedSchemas, resolveCatalogRefs } from '../services/validation/catalogCompaction';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { worldDraft, worldState } from './fixtures/world';

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value);
function nodes(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) value.forEach(item => nodes(item, out));
  else if (isNode(value)) { out.push(value); Object.values(value).forEach(item => nodes(item, out)); }
  return out;
}
/** 去掉时间/日期节点上的 pattern 与 description，用于确认时间说明之外没有任何字段变化。 */
function withoutTimeNotes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutTimeNotes);
  if (!isNode(value)) return value;
  const timeNode = value.format === 'date-time' || value.format === 'date';
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !(timeNode && (key === 'pattern' || key === 'description')))
    .map(([key, item]) => [key, withoutTimeNotes(item)]));
}
const size = (value: unknown) => JSON.stringify(value).length;

describe.each(['world', 'variables'] as const)('%s 命令目录只合并重复结构，不改变规则', (stage: 'world' | 'variables') => {
  it('展开公共定义后与原内联目录逐字段一致（时间格式除外）', () => {
    const compact = commandCatalog(stage), inline = inlineCommandCatalog(stage);
    expect(resolveCatalogRefs(compact.schema)).toEqual(describeTimeFormats(inline.schema));
    expect(compact.schema).toEqual(factorRepeatedSchemas(describeTimeFormats(inline.schema))); // generated snapshot must be fresh
    expect(withoutTimeNotes(describeTimeFormats(inline.schema))).toEqual(withoutTimeNotes(inline.schema));
  });
  it('目录其余部分原样保留，只追加一条公共定义的阅读说明', () => {
    const { schema: _compact, rules: compactRules, ...compactRest } = commandCatalog(stage);
    const { schema: _inline, rules: inlineRules, ...inlineRest } = inlineCommandCatalog(stage);
    void _compact; void _inline;
    expect(compactRest).toEqual(inlineRest);
    expect(compactRules.slice(0, inlineRules.length)).toEqual(inlineRules);
    expect(compactRules.slice(inlineRules.length)).toHaveLength(1);
    expect(compactRules.at(-1)).toContain('schema.definitions');
  });
  it('每个引用都能解析，每个公共定义都被使用，引用节点不带其他字段', () => {
    const schema = commandCatalog(stage).schema, all = nodes(schema), defined = new Set(Object.keys(schema.definitions));
    const refs = all.filter(node => typeof node.$ref === 'string');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(Object.keys(ref)).toEqual(['$ref']);
      expect(defined.has(String(ref.$ref).replace('#/definitions/', ''))).toBe(true);
    }
    const used = new Set(refs.map(ref => String(ref.$ref).replace('#/definitions/', '')));
    for (const name of defined) expect(used.has(name)).toBe(true);
  });
  it('时间与日期只给写法说明，不再发送内部校验正则', () => {
    const times = nodes(commandCatalog(stage).schema).filter(node => node.format === 'date-time' || node.format === 'date');
    expect(times.length).toBeGreaterThan(0);
    for (const node of times) { expect(node).not.toHaveProperty('pattern'); expect(String(node.description)).toMatch(/2026-10-18/); }
    expect(JSON.stringify(commandCatalog(stage))).not.toContain('[2468][048]');
  });
  it('体积上限：合并后不超过 46000 字符，且比内联目录至少少 40%', () => {
    // 加字段使目录超限时，请先确认新结构是否能复用公共定义，而不是直接放宽上限。
    const compact = size(commandCatalog(stage)), inline = size(inlineCommandCatalog(stage));
    expect(compact).toBeLessThan(46000);
    expect(compact / inline).toBeLessThan(0.6);
  });
});

describe('合并与展开的工具行为', () => {
  it('World 的字符串常量或枚举保留完整取值约束，混合枚举保留类型约束', () => {
    const properties = { status: { type:'string', enum:['planned','active'] }, kind: { type:'string', const:'npc' },
      mixed: { type:'string', enum:[1,'one'] }, text: { type:'string', minLength:1 } };
    expect(compactWorldCommandSchema({ properties })).toEqual({ properties: {
      ...properties, status: { enum: ['planned','active'] }, kind: { const:'npc' },
    } });
    const world = inlineCommandCatalog('world').schema;
    expect(world.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(world.oneOf.every(command => command.$schema === undefined)).toBe(true);
  });
  it('只抽取有明显收益的重复结构，展开后与原文相同', () => {
    const shared = { type: 'object', properties: { a: { type: 'string', minLength: 1, maxLength: 400 }, b: { type: 'string', minLength: 1, maxLength: 400 } }, required: ['a', 'b'], additionalProperties: false };
    const schema = { oneOf: [
      { type: 'object', properties: { x: shared, y: shared } },
      { type: 'object', properties: { z: shared, tiny: { type: 'boolean' }, tiny2: { type: 'boolean' } } },
    ] };
    const factored = factorRepeatedSchemas(schema);
    expect(Object.keys(factored.definitions)).toHaveLength(1);
    expect(JSON.stringify(factored)).toContain('"tiny":{"type":"boolean"}');
    expect(resolveCatalogRefs(factored)).toEqual(schema);
  });
  it('悬空或循环引用会明确报错，而不是静默丢字段', () => {
    expect(() => resolveCatalogRefs({ definitions: {}, oneOf: [{ $ref: '#/definitions/不存在' }] })).toThrow('无法展开目录引用');
    expect(() => resolveCatalogRefs({ definitions: { a: { $ref: '#/definitions/a' } }, oneOf: [{ $ref: '#/definitions/a' }] })).toThrow('无法展开目录引用');
  });
  it('目录按阶段缓存，但每次返回独立副本，调用方修改不会影响下一次', () => {
    const first = commandCatalog('world'), original = structuredClone(first);
    first.rules.push('被调用方修改'); delete first.schema.definitions['游戏时间'];
    expect(commandCatalog('world')).toEqual(original);
  });
});

describe.each(['opening', 'regular'] as const)('%s 实际发送的 World 上下文使用合并后的目录', (mode: 'opening' | 'regular') => {
  it('COMMAND_CATALOG 带公共定义，且不含日期正则', async () => {
    const state = worldState(), draft = worldDraft(true, mode);
    const prompt = await composePrompt({ stage: 'world', mode, state, draft, settings: defaultSettings(), userInput: '' });
    const catalog = prompt.context.COMMAND_CATALOG as ReturnType<typeof commandCatalog>;
    expect(catalog).toEqual(commandCatalog('world'));
    expect(Object.keys(catalog.schema.definitions)).toEqual(expect.arrayContaining(['游戏时间', '稳定ID', '实体引用']));
    // Zod/贪心提取可以命名为 time 或各精度子结构；验证正式纪事结构而非依赖某个别名。
    const resolved = resolveCatalogRefs(catalog.schema);
    const isHistory = (option: unknown) => isNode(option) && isNode(option.properties) && isNode(option.properties.type) && option.properties.type.const === 'RecordHistory';
    const history = resolved.oneOf.find(isHistory);
    const original = describeTimeFormats(inlineCommandCatalog('world').schema).oneOf.find(isHistory);
    expect(history).toBeDefined(); expect(history).toEqual(original);
    expect(JSON.stringify(prompt.messages)).not.toContain('[2468][048]');
  });
});
