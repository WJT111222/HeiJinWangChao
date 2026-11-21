import { assertImportantItem } from './variableCommands';
import { GameStateSchema } from './state';
import type { GameState } from './state';

type Path = readonly string[];
export const pointer = (path: Path) =>
  path.map((key) => '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')).join('');
export function parsePointer(text: string): string[] {
  if (!text.startsWith('/') || /~(?![01])/.test(text))
    throw new Error('请输入有效的 JSON Pointer，例如 /protagonist/age。');
  const parts = text
    .slice(1)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (parts.some((key) => ['', '__proto__', 'constructor', 'prototype'].includes(key)))
    throw new Error('路径包含不可使用的键。');
  return parts;
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export function atPath(root: unknown, parts: Path): unknown {
  let value = root;
  for (const key of parts) {
    if ((!record(value) && !Array.isArray(value)) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
export function editAtPath(state: GameState, path: string, value: unknown): GameState {
  const parts = parsePointer(path);
  const key = parts.pop()!;
  const next = structuredClone(state);
  const parent = atPath(next, parts);
  if (Array.isArray(parent)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length)
      throw new Error('数组下标不存在。新增或删除元素请编辑整个数组。');
    parent[Number(key)] = value;
  } else if (record(parent)) {
    parent[key] = value;
  } else throw new Error('父路径不存在。可在上一级编辑完整对象。');
  return next;
}
export interface VariableChange {
  path: string[];
  before: unknown;
  after: unknown;
}
export function changesBetween(before: unknown, after: unknown, path: string[] = []): VariableChange[] {
  if (Object.is(before, after)) return [];
  if (record(before) && record(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return Array.from(keys).flatMap((key) =>
      changesBetween(
        Object.hasOwn(before, key) ? before[key] : undefined,
        Object.hasOwn(after, key) ? after[key] : undefined,
        [...path, key],
      ),
    );
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((item, index) => changesBetween(item, after[index], [...path, String(index)]));
  }
  return [{ path, before, after }];
}

// Player corrections can include creation-only descriptions. Ledger, provenance, stable
// identity, talent and historical records have invariants beyond a single schema snapshot.
const personFields = [
  'name',
  'age',
  'gender',
  'appearance',
  'personality',
  'profession',
  'professionDescription',
  'professionLongTermImpact',
  'background',
  'skills',
  'healthText',
  'emotionText',
  'publicStatus',
  'legalStatus',
  'locationId',
  'currentWear',
];
const tableFields = {
  npc: [
    'name',
    'age',
    'gender',
    'aliases',
    'identity',
    'appearance',
    'temperament',
    'background',
    'skills',
    'locationId',
    'onScene',
    'healthText',
    'relationshipText',
    'addressing',
    'phoneContact',
    'usualLocations',
    'activeGoals',
    'habits',
    'detailedBackground',
    'relationshipNetwork',
  ],
  items: ['name', 'description', 'conditionText', 'itemDetails', 'questItem', 'locationId'],
  locations: ['name', 'parentId'],
  organizations: ['name', 'description', 'internalStatus', 'missionText', 'operatingStatus'],
};
type Table = keyof typeof tableFields;
function isTable(section: string): section is Table {
  return Object.hasOwn(tableFields, section);
}
export function editableVariablePath(path: Path): boolean {
  const [section, key, field] = path;
  if (['title', 'weatherText', 'environmentText', 'contactNpcIds'].includes(section)) return true;
  if (section === 'protagonist') return key === undefined || personFields.includes(key);
  return isTable(section) && (field === undefined || tableFields[section].includes(field));
}
export function validateVariableEdit(original: GameState, input: unknown): GameState {
  const parsed = GameStateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`存档校验失败（${pointer(issue.path.map(String))}）：${issue.message}`);
  }
  for (const { path } of changesBetween(original, parsed.data)) {
    const [section = '', key = '', field = ''] = path;
    if (section === 'items' && field === 'name')
      assertImportantItem(parsed.data, parsed.data.items[key]);
    if (section === 'organizations' && field === 'name') {
      const org = parsed.data.organizations[key];
      if (
        Object.values(parsed.data.organizations).some(
          (other) => other.id !== key && other.kind === org.kind && other.name === org.name,
        )
      )
        throw new Error('同类组织名称已存在，请保留各自身份。');
    }
    if (section === 'npc' && (field === 'age' || field === 'gender')) {
      const person = parsed.data.npc[key];
      if (
        ((person?.kind === 'special' && person.privateProfile) ||
          parsed.data.dormantNpcProfiles?.[key]?.profile.privateProfile) &&
        (person.gender !== 'female' || (person.age !== undefined && person.age < 18))
      ) {
        throw new Error('此修改与该人物已有专属档案的年龄或性别资格冲突。');
      }
    }
    const existingEntityField =
      !isTable(section) || (field !== '' && Object.hasOwn(original[section], key));
    if (existingEntityField && editableVariablePath(path)) continue;
    throw new Error(`只读或由专用事务维护的字段：${pointer(path)}。实体身份、财务和历史记录受保护。`);
  }
  return parsed.data;
}
