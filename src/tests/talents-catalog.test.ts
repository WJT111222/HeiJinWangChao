import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getTalentDefinition, talentDefinitions, TalentIdSchema } from '../domain/protagonist/talents';
import expected from './fixtures/talents-v2.json';

const sections = ['introduction', 'mechanism', 'longTermImpact', 'boundary'] as const;

describe('八大天赋 V2：权威资料目录 T01–T02', () => {
  it('固定八种身份、名称、核心领域及机制，一一对应且顺序不变', () => {
    expect(talentDefinitions).toHaveLength(8);
    expect(talentDefinitions.map(({ id, name, coreDomain, mechanismName }) => ({ id, name, coreDomain, mechanismName })))
      .toEqual(expected.map(({ id, name, coreDomain, mechanismName }) => ({ id, name, coreDomain, mechanismName })));
    expect(new Set(talentDefinitions.map(t => t.id)).size).toBe(8);
    expect(new Set(talentDefinitions.map(t => t.name)).size).toBe(8);
    expect(TalentIdSchema.options).toEqual(expected.map(t => t.id));
  });

  it.each(expected)('$name 的四段全文与上传规范的独立 SHA-256 定稿一致', record => {
    const definition = getTalentDefinition(record.id)!;
    expect(Object.keys(definition).sort()).toEqual(['id', 'name', 'coreDomain', 'mechanismName', ...sections].sort());
    for (const field of sections) {
      expect(definition[field].trim()).not.toBe('');
      expect(createHash('sha256').update(definition[field], 'utf8').digest('hex')).toBe(record.sha256[field]);
    }
  });

  it('目录、记录只读；查询不暴露可变对象', () => {
    expect(Object.isFrozen(talentDefinitions)).toBe(true);
    for (const record of talentDefinitions) {
      expect(Object.isFrozen(record)).toBe(true);
      expect(getTalentDefinition(record.id)).toBe(record);
      expect(Reflect.set(record, 'introduction', '不能篡改')).toBe(false);
    }
    expect(Reflect.set(talentDefinitions, 0, talentDefinitions[1])).toBe(false);
  });

  it.each(expected)('稳定 ID $id 合法', ({ id }) => {
    expect(TalentIdSchema.parse(id)).toBe(id);
  });

  it.each([null, 'none', '', '枭雄光环', 'unknown', 'UNDERWORLD_AURA', '__proto__', 'constructor',
    ['underworld_aura'], ['underworld_aura', 'cyber_tyrant'], { id: 'underworld_aura' }, 1, true])(
    '拒绝非单一稳定 ID：%j', value => {
      expect(TalentIdSchema.safeParse(value).success).toBe(false);
      expect(getTalentDefinition(value)).toBeUndefined();
    },
  );

  it('缺失字段查询不分配或推断天赋', () => {
    expect(getTalentDefinition(undefined)).toBeUndefined();
  });
});
