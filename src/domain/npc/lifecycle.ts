import { requireData } from '../common';
import type { GameState } from '../state';
import type { WorldTask } from '../events/schema';

export const terminalTask = (task: WorldTask) => ['completed', 'cancelled'].includes(task.status);
const sameActor = (a: WorldTask, b: WorldTask) => a.actorRef.kind === b.actorRef.kind && a.actorRef.id === b.actorRef.id;

// 校验真实时间区间，而不是强迫接班等待下一回合。旧终态缺实际结束记录不猜补时间。
export function validateTaskTransitions(before: GameState, after: GameState, changed: readonly WorldTask[]) {
  for (const task of changed) {
    const old = before.tasks[task.id];
    requireData(!old || (sameActor(old, task) && old.goal === task.goal && old.startAt === task.startAt
      && old.completionCondition === task.completionCondition), 'TASK_ACTOR', '历史任务身份与职责不能改派');
    if (task.handoff) {
      requireData(!old || JSON.stringify(old.handoff) === JSON.stringify(task.handoff), 'HANDOFF_IMMUTABLE', '不能事后补造或改写交接');
      const repeated = Object.values(after.tasks).filter((other) => other.handoff?.fromTaskId === task.handoff?.fromTaskId
        && sameActor(other, task) && other.goal === task.goal);
      requireData(repeated.length === 1, 'DUPLICATE_HANDOFF', '不能重复交接同一成果与职责');
    }
  }
}
