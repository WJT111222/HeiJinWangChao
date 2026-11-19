import { existingLegacyRecovery } from '../../domain/events/legacyNotification';
import { validateStoryEventInteractions } from '../../domain/events/interactions';
import { validateVariableWork } from './variableWork';
import { requireData } from '../../domain/common';
import { fingerprint } from '../../domain/commands';
import { completeTurnDraft, turnCommands, settlementDraft } from '../../domain/turnCommit';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { parseVariables, revalidateWorld } from './aiOutputs';
import { validateCommittedTime, timeOutcome } from '../../domain/timePreflight';

// 提交边界重新验证，不信任持久化 validated；同一事务内仅运行同步纯计算。
export function validateTurnCandidates(state: GameState, input: TurnDraft) {
  requireData(completeTurnDraft(input), 'TURN_INCOMPLETE', '正文或已启用阶段尚未完整完成');
  const draft = settlementDraft(input);
  validateStoryEventInteractions(state, draft.story!,existingLegacyRecovery(state,draft));
  timeOutcome(state, draft, true);
  if (draft.variables) parseVariables(JSON.stringify(draft.variables.result), state, draft);
  if (draft.world) {
    const world = revalidateWorld(state, draft);
    requireData(fingerprint(world) === fingerprint(draft.world.result), 'WORLD_NORMALIZATION', '世界候选需先保存程序校验后的完整成果元数据');
  }
  validateCommittedTime(state, draft);
  const projected = projectTurn(state, draft);
  for (const command of draft.variables?.result.commands ?? []) validateVariableWork(state, draft, projected, command);
  const commands = turnCommands(draft, state);
  requireData(
    new Set(commands.map((c) => c.commandId)).size === commands.length,
    'DUPLICATE_COMMAND',
    '跨阶段命令 ID 重复',
  );
}
