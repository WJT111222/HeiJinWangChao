import type { WorldTask } from '../../domain/events/schema';
import { requireWorld } from './worldDiagnostics';

/** 任务文本的比较键：忽略空白与全半角差异（NFKC），只用于判断“是不是同一内容”。 */
export const taskTextKey = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
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
 * 只差空白、全半角或同一时刻的不同写法时，沿用存档原值并返回处理说明；
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
  return `SaveTask（${task.id}）：${adopted.map((key) => identityLabels[key]).join('、')}与存档只差空白、全半角或时间写法，已沿用存档原值。`;
}
