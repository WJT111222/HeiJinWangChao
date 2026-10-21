import { requireData } from '../../domain/common';
import { fingerprint } from '../../domain/commands';
import { completeTurnDraft, turnCommands } from '../../domain/turnCommit';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { parseVariables, parseWorld } from './aiOutputs';
import { hasAffirmedTermination } from './worldEvidence';
import { isNegatedFact } from '../../domain/factPolarity';

// 提交边界重新验证，不信任持久化 validated；同一事务内仅运行同步纯计算。
export function validateTurnCandidates(state: GameState, draft: TurnDraft) {
  requireData(completeTurnDraft(draft), 'TURN_INCOMPLETE', '三阶段尚未完整完成');
  parseVariables(JSON.stringify(draft.variables!.result), state, draft);
  parseWorld(JSON.stringify(draft.world!.result), state, draft);
  // 现场 SaveTask/SaveEvent 原来只有字符串事实与结构检查；正式落库前补足时间/终态边界。
  const projected = projectTurn(state, draft);
  const ready = (conditions: string[]) =>
    conditions.every((id) => {
      const task = state.tasks[id.replace(/^task:/, '')];
      const event = state.events[id.replace(/^event:/, '')];
      return task?.status === 'completed' || event?.status === 'resolved';
    });
  for (const command of draft.variables!.result.commands) {
    if (command.type !== 'SaveTask' && command.type !== 'SaveEvent') continue;
    const task = command.type === 'SaveTask' ? command.task : undefined;
    const event = command.type === 'SaveEvent' ? command.event : undefined;
    const work = task ?? event!;
    const old = task ? state.tasks[work.id] : state.events[work.id];
    const target = old ?? work;
    const label = 'goal' in target ? target.goal : target.title;
    const matches = task
      ? Object.values(projected.tasks).filter((item) => item.goal === label)
      : Object.values(projected.events).filter((item) => item.title === label);
    const namesTarget =
      command.evidence.includes(work.id) ||
      (matches.length === 1 && command.evidence.includes(label));
    const refs = task ? [task.actorRef] : event!.actorRefs;
    requireData(
      refs.every((ref) => ref.kind !== 'npc' || Boolean(projected.npc[ref.id]?.onScene)),
      'SCENE_PERMISSION',
      '场外任务或事件必须由世界阶段处理',
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
      if ('actorRefs' in old && event)
        requireData(
          fingerprint(old.actorRefs) === fingerprint(event.actorRefs),
          'EVENT_ACTORS',
          '事件参与者不能改写',
        );
      if (['active', 'blocked'].includes(old.status))
        requireData(
          !['planned', 'scheduled'].includes(work.status),
          'WORK_STATUS',
          '活动不能退回计划',
        );
    }
    const terminal = ['completed', 'resolved'].includes(work.status);
    if (['active', 'blocked', 'completed', 'resolved'].includes(work.status))
      requireData(
        Date.parse(work.startAt) <= Date.parse(projected.worldClock),
        'WORK_TIME',
        '未来行动尚未发生',
      );
    if (terminal) {
      requireData(namesTarget, 'WORK_EVIDENCE', '完成事实未关联目标任务或事件');
      requireData(
        ready([
          ...(old?.prerequisites ?? []),
          ...(old?.blockers ?? []),
          ...work.prerequisites,
          ...work.blockers,
        ]),
        'WORK_BLOCKED',
        '完成条件未满足',
      );
      const match = /已(?:经)?(?:完成|结束|办妥|成功)|完成了|已结案/g;
      requireData(
        [...command.evidence.matchAll(match)].some(
          (m) => !isNegatedFact(command.evidence, m.index, m.index + m[0].length),
        ),
        'WORK_EVIDENCE',
        '缺少肯定成立的实际完成依据',
      );
    }
    if (work.status === 'cancelled') {
      // 正文无需暴露后台 ID；已存在且名称无歧义时可用原任务目标/事件标题关联。
      requireData(
        old && namesTarget && hasAffirmedTermination(command.evidence),
        'WORK_EVIDENCE',
        '取消需绑定已有对象和肯定终止事实',
      );
    }
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
  const commands = turnCommands(draft);
  requireData(
    new Set(commands.map((c) => c.commandId)).size === commands.length,
    'DUPLICATE_COMMAND',
    '跨阶段命令 ID 重复',
  );
}
