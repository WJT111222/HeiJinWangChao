import { z } from 'zod';
import { openingTimeBase } from './openingTime';
import { requireData } from './common';
import { commitCommands } from './commands';
import type { DomainCommand } from './commands';
import { TurnDraftSchema } from './drafts';
import type { TurnDraft } from './drafts';
import { GameStateSchema } from './state';
import type { GameState } from './state';
import { MemoryEntrySchema } from './memories/schema';
import { validateCommittedTime } from './timePreflight';

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
// 保留独立 commitCommands 的旧契约；正式剧情提交另验正向时间及纯历史视角例外。
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
  validateCommittedTime(current, draft);
  const commands = turnCommands(draft);
  // 不能混入同 turnId 先前独立 save 的命令，再把一次不完整结算伪装为新回合。
  requireData(
    !current.appliedCommands.some((entry) => entry.turnId === draft.turnId),
    'TURN_CONTEXT',
    '回合已有独立命令记录',
  );
  const projected = commitCommands(openingTimeBase(current, draft), draft.turnId, current.revision, commands, now);
  requireData(draft.story!.summary.trim(), 'MISSING_SUMMARY', '正文缺少有效摘要，请重新生成正文后重试');
  const shortMemory = MemoryEntrySchema.parse({
    id: draft.turnId,
    text: draft.story!.summary,
    sourceTurnIds: [draft.turnId],
    affectedEntityRefs: [],
    visibility: 'player_known',
    createdAtGameTime: projected.worldClock,
  });
  requireData(!projected.memories.short.some((entry) => entry.id === shortMemory.id || entry.sourceTurnIds.includes(draft.turnId)),
    'MEMORY_ID_CONFLICT', '短期记忆 ID 冲突');
  const next = {
    ...projected,
    memories: { ...projected.memories, short: [...projected.memories.short, shortMemory] },
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
