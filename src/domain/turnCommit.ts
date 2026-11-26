import { effectiveEntityCandidate } from './entityCandidate';
import { commandsForPhase } from './stageCommands';
import { hasVisibleNarrative } from './storyContent';
import { validateStageSettlement } from './events/stages';
import { historicalPerspective } from './timePreflight';
import { z } from 'zod';
import { projectTurn, preparedVariableCommands, variableCommandsForTurn } from './turnProjection';
import { requireData } from './common';
import type { DomainCommand } from './commands';
import { TurnDraftSchema } from './drafts';
import type { TurnDraft } from './drafts';
import { GameStateSchema } from './state';
import type { GameState } from './state';
import { MemoryEntrySchema } from './memories/schema';
import { validateCommittedTime } from './timePreflight';
import { openingTimeSelection } from './openingTime';

export const TurnSubmissionSchema = z.strictObject({
  draft: TurnDraftSchema,
  // 空字符串仅表示已提交后等待玩家输入，不授权下一次生成。
  nextAction: z.string().max(100000).refine(value => value === '' || value.trim().length > 0).transform(value => value.trim()),
  useEntityStage: z.boolean().optional(),
  useVariableStage: z.boolean(),
  useWorldStage: z.boolean(),
});
export type TurnSubmission = z.infer<typeof TurnSubmissionSchema>;
export function awaitingPlayerAction(state: GameState, draft?: TurnDraft) {
  return Boolean(draft && state.turnNumber > 0 && draft.turnKind === 'regular' && draft.userInput === ''
    && draft.baseSaveRevision === state.revision && draft.storyRevision === 0 && draft.executionRevision === 0
    && !draft.story && !draft.entities && !draft.variables && !draft.world && draft.failures.length === 0);
}
/**
 * 已绑定行动、但正文失败或被取消且尚未产生任何候选的普通回合。
 * 仅判断可回填/重绑的数据形态，pending 也可能仍在运行，failed 也可能正在手动重试。
 * 是否允许写入或发送必须另外取得跨标签执行锁；本函数不证明请求已经停止。
 */
export function rebindableAfterStoryStop(state: GameState, draft?: TurnDraft) {
  return Boolean(draft && state.turnNumber > 0 && draft.turnKind === 'regular' && draft.userInput.trim() !== ''
    && draft.baseSaveRevision === state.revision && draft.executionRevision === 0
    && !draft.story && !draft.entities && !draft.variables && !draft.world && draft.stageStatus.story !== 'ready');
}
// 这里只检查候选和阶段依赖是否齐备；正式就绪还需按存档状态校验开局时间。
export function completeTurnDraft(draft: TurnDraft) {
  const parsed = TurnDraftSchema.safeParse(draft);
  if (!parsed.success) return false;
  const current = parsed.data;
  const ready = (stage: 'entities' | 'variables' | 'world') => current.stageStatus[stage] === 'ready' && current[stage]?.validation === (stage === 'entities' ? 'structural' : 'validated');
  const complete = (stage: 'entities' | 'variables' | 'world', enabled: boolean) => ready(stage)
    || (!enabled && current.stageStatus[stage] === 'skipped' && !current[stage]);
  return Boolean(current.story && hasVisibleNarrative(current.story.narrative) && current.stageStatus.story === 'ready'
    && complete('entities', current.useEntityStage) && complete('variables', current.useVariableStage) && complete('world', current.useWorldStage)
    && (!current.world || (!current.useVariableStage || ready('variables')) && current.world.basedOnVariableRevision === current.variables?.candidateRevision));
}
// 只读结算投影：保留草稿内可复用候选，但关闭阶段不应用其结果。
// World 仍可复用原有合法 Variables 依赖；纯小说模式不应用任何下游候选。
export function settlementDraft(draft: TurnDraft): TurnDraft {
  const useVariables = draft.useVariableStage;
  return TurnDraftSchema.parse({ ...draft,
    variables: useVariables ? draft.variables : undefined,
    world: draft.useWorldStage ? draft.world : undefined,
    stageStatus: { ...draft.stageStatus,
      variables: useVariables ? draft.stageStatus.variables : 'skipped',
      world: draft.useWorldStage ? draft.stageStatus.world : 'skipped',
    },
  });
}
export function turnCommands(input: TurnDraft, state: GameState): DomainCommand[] {
  const draft = settlementDraft(input);
  return [
    ...(draft.variables || draft.entities ? preparedVariableCommands(state, draft, draft.variables?.result.commands ?? []) : variableCommandsForTurn(state, draft, [])),
    ...(draft.world?.result.worldCommands ?? []),
    ...(draft.world?.result.taskCommands ?? []),
    ...(draft.world?.result.eventCommands ?? []),
  ];
}
// 正式提交保持同一候选投影，另验历史回顾不修改当前世界。
export function settleTurn(state: GameState, input: TurnDraft, now: string): GameState {
  const current = GameStateSchema.parse(state),
    storedDraft = TurnDraftSchema.parse(input);
  requireData(completeTurnDraft(storedDraft), 'TURN_INCOMPLETE', '需要合法正文与所有已启用阶段的候选');
  const draft = settlementDraft(storedDraft);
  const allowed = new Set(commandsForPhase('scene', draft.turnKind));
  requireData(draft.variables?.result.commands.every(command => allowed.has(command.type)) ?? true,
    'STAGE_PERMISSION', '主角与现场阶段命令越权');
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
  requireData(completeTurnDraft(draft), 'TURN_INCOMPLETE', '需要合法正文与所有已启用阶段的候选');
  validateCommittedTime(current, draft);
  // 不能混入同 turnId 先前独立 save 的命令，再把一次不完整结算伪装为新回合。
  requireData(
    !current.appliedCommands.some((entry) => entry.turnId === draft.turnId),
    'TURN_CONTEXT',
    '回合已有独立命令记录',
  );
  const world = draft.world?.result;
  const projected = projectTurn(current, draft, world ? [...world.worldCommands, ...world.taskCommands, ...world.eventCommands] : []);
  if (world && !historicalPerspective(current, draft)) {
    const beforeWorld = projectTurn(current, draft);
    validateStageSettlement(beforeWorld, projected, draft.turnId, world.deferredEvents?.filter(id => beforeWorld.events[id]?.eventKind === 'sub'));
  }
  const entitySettlement = effectiveEntityCandidate(current, draft, draft.variables?.result.commands ?? []).settlement;
  const variableSettlement = draft.variables?.result.settlement;
  const worldSettlement = world?.settlement;
  const deferred = world?.deferredEvents?.length;
  const settlement = entitySettlement || variableSettlement || worldSettlement || deferred
    ? { entities: entitySettlement, variables: variableSettlement, world: worldSettlement, deferred } : undefined;
  projected.updatedAt = now;
  delete projected.openingInitializationPending;
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
        ...(settlement ? { settlement } : {}),
        scene: {
          worldClock: openingTimeSelection(current, draft)?.startAt ?? current.worldClock,
          // The formal opening origin precedes any movement in this turn, just as in regular turns.
          locationId: current.protagonist.locationId,
        },
      },
    ],
  };
  return GameStateSchema.parse(next);
}
