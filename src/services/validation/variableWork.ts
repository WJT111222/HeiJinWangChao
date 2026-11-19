import { validateSceneEventUpdate } from '../../domain/events/scenePermission';
import { requireData } from '../../domain/common';
import { fingerprint } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';

export function validateVariableWork(state: GameState, draft: TurnDraft, projected: GameState, command: DomainCommand) {
  if (command.type !== 'SaveTask' && command.type !== 'SaveEvent') return;
  const task = command.type === 'SaveTask' ? command.task : undefined;
  const event = command.type === 'SaveEvent' ? command.event : undefined;
  const work = task ?? event!;
  const old = task ? state.tasks[work.id] : state.events[work.id];
  if (event) validateSceneEventUpdate(state, projected, event, draft.turnId,draft.story);
  if (task) requireData(
    task.actorRef.kind !== 'npc' || Boolean(projected.npc[task.actorRef.id]?.onScene),
    'SCENE_PERMISSION',
    '场外任务必须由世界阶段处理',
  );
  if (old) {
    requireData(
      old.startAt === work.startAt && old.completionCondition === work.completionCondition,
      'WORK_CONTEXT',
      '既有任务起点和完成条件不可改写',
    );
    if ('actorRef' in old && task)
      requireData(
        fingerprint(old.actorRef) === fingerprint(task.actorRef) && old.goal === task.goal,
        'TASK_ACTOR',
        '任务不能改派',
      );
    if (['active', 'blocked'].includes(old.status))
      requireData(
        !['planned', 'scheduled'].includes(work.status),
        'WORK_STATUS',
        '活动不能退回计划',
      );
  }
  if (['active', 'blocked', 'completed', 'resolved'].includes(work.status))
    requireData(
      Date.parse(work.startAt) <= Date.parse(projected.worldClock),
      'WORK_TIME',
      '未来行动尚未发生',
    );
  if (work.status === 'cancelled')
    requireData(old, 'WORK_CONTEXT', '取消必须关联已有任务或事件');
  if (event) {
    requireData(
      event.sourceTurnIds.includes(draft.turnId) &&
        event.sourceTurnIds.every(
          (id) => id === draft.turnId || state.journal.some((entry) => entry.turnId === id),
        ) &&
        (!old ||
          !('sourceTurnIds' in old) ||
          old.sourceTurnIds.every((id) => event.sourceTurnIds.includes(id))),
      'EVENT_SOURCE',
      '事件需关联当前事实回合',
    );
    if (event.status === 'resolved')
      requireData(
        event.resolvedAt &&
          event.resolutionText?.trim() &&
          Date.parse(event.resolvedAt) <= Date.parse(projected.worldClock),
        'EVENT_TIME',
        '事件缺少实际结案信息',
      );
    if (['scheduled', 'active', 'blocked'].includes(event.status))
      requireData(
        event.resolvedAt === undefined && event.resolutionText === undefined,
        'EVENT_TIME',
        '非结案事件不能预存结局',
      );
    if (event.resolvedAt)
      requireData(
        Date.parse(event.resolvedAt) <= Date.parse(projected.worldClock),
        'EVENT_TIME',
        '实际终止时间超出窗口',
      );
  }
}
