import type { WorldTask } from '../../domain/events/schema';
import { requireWorld } from './worldDiagnostics';

/** 只容许首尾空白、顿号两侧及指定中文标点后的普通/全角空格和全角数字差异。 */
const taskTextKey = (text: string) => text.trim()
  .replace(/[ \u3000]*、[ \u3000]*/gu, '、')
  .replace(/([，。；：！？])[ \u3000]+/gu, '$1')
  .replace(/[０-９]/gu, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
export function sameTaskText(a: string | undefined, b: string | undefined) {
  return a === b || (a !== undefined && b !== undefined && taskTextKey(a) === taskTextKey(b));
}
/** 同一时刻的不同写法（例如时区偏移不同）视为相同开始时间。 */
export function sameTaskInstant(a: string, b: string) {
  const left = Date.parse(a), right = Date.parse(b);
  return a === b || (!Number.isNaN(left) && left === right);
}

const identityLabels = { goal: '目标', startAt: '开始时间', completionCondition: '完成条件' } as const;
const identityFields = ['goal', 'startAt', 'completionCondition'] as const;

/**
 * 既有任务的目标、开始时间、完成条件不可改写（#193）。
 * 只差允许的排版变化或同一时刻的不同写法时，沿用存档原值并返回处理说明；
 * 内容确有不同仍按 task_immutable 拒绝。所有字段检查通过后才改写候选，失败时候选保持原样。
 */
export function keepTaskIdentity(old: WorldTask, task: WorldTask): string | undefined {
  const adopted = identityFields.filter((key) => old[key] !== task[key]);
  for (const key of adopted) {
    const same = key === 'startAt' ? sameTaskInstant(old.startAt, task.startAt) : sameTaskText(old[key], task[key]);
    requireWorld(same, 'invalid_output', 'task_immutable', `task.${key}`);
  }
  if (!adopted.length) return undefined;
  Object.assign(task, Object.fromEntries(adopted.map((key) => [key, old[key]])));
  return `SaveTask（${task.id}）：${adopted.map((key) => identityLabels[key]).join('、')}与存档只差排版或时间写法，已沿用存档原值。`;
}
