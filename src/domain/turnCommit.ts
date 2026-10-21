import { z } from 'zod';
import { requireData } from './common';
import { commitCommands, fingerprint } from './commands';
import type { DomainCommand } from './commands';
import { TurnDraftSchema } from './drafts';
import type { TurnDraft } from './drafts';
import { GameStateSchema } from './state';
import type { GameState } from './state';

export const TurnSubmissionSchema = z.strictObject({
  draft: TurnDraftSchema,
  nextAction: z.string().trim().min(1).max(100000),
  useVariableStage: z.boolean(),
  useWorldStage: z.boolean(),
});
export type TurnSubmission = z.infer<typeof TurnSubmissionSchema>;
export function completeTurnDraft(draft: TurnDraft) {
  return (
    draft.useVariableStage &&
    draft.useWorldStage &&
    draft.story &&
    draft.stageStatus.story === 'ready' &&
    draft.stageStatus.variables === 'ready' &&
    draft.stageStatus.world === 'ready' &&
    draft.variables?.validation === 'validated' &&
    draft.world?.validation === 'validated' &&
    draft.world.basedOnVariableRevision === draft.variables.candidateRevision
  );
}
export function turnCommands(draft: TurnDraft): DomainCommand[] {
  return [
    ...(draft.variables?.result.commands ?? []),
    ...(draft.world?.result.worldCommands ?? []),
    ...(draft.world?.result.taskCommands ?? []),
    ...(draft.world?.result.eventCommands ?? []),
  ];
}
// 保留 commitCommands 的旧契约；回合即使零命令，也独立递增一次正式版本并追加原文。
export function settleTurn(state: GameState, input: TurnDraft, now: string): GameState {
  const current = GameStateSchema.parse(state),
    draft = TurnDraftSchema.parse(input);
  requireData(
    current.saveId === draft.saveId && current.revision === draft.baseSaveRevision,
    'REVISION_CONFLICT',
    '正式版本已改变',
  );
  requireData(
    !current.journal.some((entry) => entry.turnId === draft.turnId),
    'TURN_ALREADY_COMMITTED',
    '回合已提交',
  );
  requireData(
    draft.turnKind === (current.turnNumber === 0 ? 'opening' : 'regular'),
    'TURN_CONTEXT',
    '回合模式不符',
  );
  requireData(completeTurnDraft(draft), 'TURN_INCOMPLETE', '需要完整合法的三阶段候选');
  const commands = turnCommands(draft);
  // 不能混入同 turnId 先前独立 save 的命令，再把一次不完整结算伪装为新回合。
  requireData(
    !current.appliedCommands.some((entry) => entry.turnId === draft.turnId),
    'TURN_CONTEXT',
    '回合已有独立命令记录',
  );
  const occupied = new Map<string, Set<string>>();
  const occupy = (id: string, taskId: string) => {
    const tasks = occupied.get(id) ?? new Set<string>();
    tasks.add(taskId);
    occupied.set(id, tasks);
    requireData(tasks.size <= 1, 'NPC_TASK_CONFLICT', 'NPC 后台任务占用冲突');
  };
  for (const task of Object.values(current.tasks))
    if (task.actorRef.kind === 'npc' && !['completed', 'cancelled'].includes(task.status))
      occupy(task.actorRef.id, task.id);
  for (const command of commands)
    if (command.type === 'SaveTask') {
      const task = command.task,
        old = current.tasks[task.id];
      requireData(
        !old || fingerprint(old.actorRef) === fingerprint(task.actorRef),
        'TASK_ACTOR',
        '任务不能改派执行人',
      );
      if (
        task.actorRef.kind === 'npc' &&
        (!old || !['completed', 'cancelled'].includes(task.status))
      )
        occupy(task.actorRef.id, task.id);
    }
  const projected = commitCommands(current, draft.turnId, current.revision, commands, now);
  const next = {
    ...projected,
    revision: current.revision + 1,
    updatedAt: now,
    turnNumber: current.turnNumber + 1,
    journal: [
      ...current.journal,
      {
        turnId: draft.turnId,
        revision: current.revision + 1,
        story: draft.story!,
        relatedActorRefs: [],
      },
    ],
  };
  const knownTurns = new Set(next.journal.map((entry) => entry.turnId));
  for (const id of draft.world!.result.timelineCandidates) {
    const event = next.events[id];
    requireData(
      event?.status === 'resolved' &&
        event.visibility === 'known' &&
        event.impact === 'major' &&
        event.resolvedAt &&
        event.resolutionText?.trim() &&
        Date.parse(event.resolvedAt) <= Date.parse(next.worldClock) &&
        event.sourceTurnIds.every((turnId) => knownTurns.has(turnId)),
      'TIMELINE_NOT_PUBLIC',
      '时间线候选不满足已知重大结案条件',
    );
    requireData(event.resolvedAt && event.resolutionText, 'TIMELINE_NOT_PUBLIC', '缺少结案依据');
    if (!next.timeline.some((entry) => entry.eventId === id))
      next.timeline.push({
        eventId: id,
        occurredAt: event.resolvedAt,
        title: event.title,
        summary: event.title,
        outcome: event.resolutionText,
        longTermImpact: '',
        actorRefs: [],
        sourceTurnIds: event.sourceTurnIds,
        ...(event.locationId ? { locationId: event.locationId } : {}),
      });
  }
  return GameStateSchema.parse(next);
}
