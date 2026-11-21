import { expect, it } from 'vitest';
import { validateVariableEdit } from '../domain/playerVariables';
import { registeredPaths, revisePath, rootsFor, sections } from '../ui/settings/variableSections';
import { worldState } from './fixtures/world';

it('实际存档根字段各归一个分区，登记表可检索准确的 JSON Pointer', () => {
  const state = worldState();
  expect(sections.flatMap((name) => rootsFor(state, name)).sort()).toEqual(
    Object.keys(state).sort(),
  );
  expect(registeredPaths(state, '/npc/scene/age', 40)).toHaveLength(
    state.npc.scene.age === undefined ? 0 : 1,
  );
  expect(registeredPaths(state, '/protagonist/name', 40)).toEqual([
    { path: ['protagonist', 'name'], type: 'string' },
  ]);
  expect(registeredPaths(state, '', 4)).toHaveLength(5);
});

it('路径操作保留类型与数组顺序，保护规则在同一份候选上执行', () => {
  const state = worldState();
  const aged = revisePath(state, '/protagonist/age', 'add', 1);
  const skills = revisePath(aged, '/protagonist/skills', 'push', '区域调查');
  expect(validateVariableEdit(state, skills).protagonist.skills).toEqual([
    ...state.protagonist.skills,
    '区域调查',
  ]);
  const result = revisePath(
    skills,
    '/protagonist/skills/' + state.protagonist.skills.length,
    'delete',
    undefined,
  );
  expect(validateVariableEdit(state, result)).toEqual({
    ...state,
    protagonist: { ...state.protagonist, age: state.protagonist.age + 1 },
  });
  expect(() => revisePath(state, '/npc', 'push', {})).toThrow();
  expect(() => revisePath(state, '/protagonist/age', 'add', '1')).toThrow();
  expect(() => revisePath(state, '/npc/__proto__', 'set', 'x')).toThrow();
  expect(() =>
    validateVariableEdit(state, revisePath(state, '/npc/scene/id', 'delete', undefined)),
  ).toThrow();
});
