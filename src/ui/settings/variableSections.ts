import type { GameState } from '../../domain/state';
import { atPath, editAtPath, parsePointer, pointer } from '../../domain/playerVariables';

export const sectionRoots = {
  主角: ['protagonist'],
  人物: ['npc', 'initialCompanionId', 'dormantNpcProfiles', 'contactNpcIds'],
  世界: [
    'worldClock',
    'weatherText',
    'environmentText',
    'locations',
    'events',
    'retiredEvents',
    'tasks',
  ],
  组织: ['organizations'],
  经济: ['economy'],
  物品: ['items'],
  记忆: ['memories'],
  历史: ['timeline', 'journal', 'appliedCommands'],
} satisfies Record<string, (keyof GameState)[]>;
export const sections = [...Object.keys(sectionRoots), '存档'] as const;
const classified = new Set<string>(Object.values(sectionRoots).flat());
export function rootsFor(state: GameState, section: string) {
  const roots: string[] = sectionRoots[section as keyof typeof sectionRoots] ?? [];
  return section === '存档'
    ? Object.keys(state).filter((k) => !classified.has(k))
    : roots.filter((k) => Object.hasOwn(state, k));
}

export const labels: Record<string, string> = {
  protagonist: '主角',
  npc: '人物',
  items: '物品',
  locations: '地点',
  organizations: '组织',
  tasks: '任务',
  events: '事件',
  economy: '经济',
  timeline: '时间线',
  journal: '正式回合',
  memories: '记忆',
  contactNpcIds: '联系人',
  retiredEvents: '已归档事件',
  title: '存档标题',
  worldClock: '世界时间',
  weatherText: '天气',
  environmentText: '环境',
  dormantNpcProfiles: '休眠人物档案',
  initialCompanionId: '初始同伴',
  appliedCommands: '已执行命令',
  name: '姓名',
  age: '年龄',
  gender: '性别',
  appearance: '外貌',
  personality: '性格',
  locationId: '所在地点',
  onScene: '在场',
  addressing: '双向称呼',
  playerToNpc: '主角称呼此人',
  npcToPlayer: '此人称呼主角',
};
export const json = (v: unknown) => JSON.stringify(v, null, 2) ?? '';
export const typeName = (v: unknown) =>
  v === undefined ? '未设置' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

export type Operation = 'set' | 'add' | 'push' | 'delete';
export function revisePath(state: GameState, path: string, operation: Operation, value: unknown) {
  const parts = parsePointer(path);
  const current = atPath(state, parts);
  if (operation === 'add') {
    if (
      typeof current !== 'number' ||
      typeof value !== 'number' ||
      !Number.isFinite(current + value)
    )
      throw new Error('增减仅适用于数值字段和有效数字。');
    return editAtPath(state, path, current + value);
  }
  if (operation === 'push') {
    if (!Array.isArray(current)) throw new Error('追加仅适用于数组。');
    return editAtPath(state, path, [...current, value]);
  }
  if (operation === 'delete') {
    const key = parts.pop()!;
    if (!parts.length || current === undefined) throw new Error('请选择已存在的非根字段。');
    const parent = atPath(state, parts);
    if (Array.isArray(parent))
      return editAtPath(
        state,
        pointer(parts),
        parent.filter((_, i) => String(i) !== key),
      );
    const updated = { ...(parent as Record<string, unknown>) };
    delete updated[key];
    return editAtPath(state, pointer(parts), updated);
  }
  return editAtPath(state, path, value);
}

// Only retain one page of matches, even for a long journal.
export function registeredPaths(state: GameState, search: string, limit: number) {
  const rows: { path: string[]; type: string }[] = [];
  const needle = search.trim().toLowerCase();
  function visit(path: string[], value: unknown) {
    if (pointer(path).toLowerCase().includes(needle)) rows.push({ path, type: typeName(value) });
    if (value === null || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (rows.length > limit) break;
      visit([...path, key], (value as Record<string, unknown>)[key]);
    }
  }
  for (const key of Object.keys(state)) {
    if (rows.length > limit) break;
    visit([key], atPath(state, [key]));
  }
  return rows;
}
