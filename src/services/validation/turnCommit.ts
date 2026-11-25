import { existingLegacyRecovery } from '../../domain/events/legacyNotification';
import { validateStoryEventInteractions } from '../../domain/events/interactions';
import { validateVariableWork } from './variableWork';
import { DataError, requireData } from '../../domain/common';
import { fingerprint } from '../../domain/commands';
import { completeTurnDraft, turnCommands, settlementDraft } from '../../domain/turnCommit';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { parseVariables, revalidateWorld } from './aiOutputs';
import { validateCommittedTime, timeOutcome, validateTimeCommands } from '../../domain/timePreflight';
import { openingTimeFailureReasons, variablesChooseOpening } from '../../domain/openingTime';
import { StoryValidationError } from '../../domain/storyDiagnostics';
import { attachFailureDiagnostic, type FailureDiagnostic } from '../ai/failureDiagnostic';
import { parseStoryGuide } from './storyGuide';

/** Only inspect the effective draft, after the same stage projection used at commit. */
export function openingSettlementIssue(state: GameState, effective: TurnDraft) {
  const { story, useVariableStage, useWorldStage } = effective;
  if (!state.openingTimePending || !story) return undefined;
  const commands = effective.variables?.result.commands ?? [];
  try { validateTimeCommands(state, effective, commands); }
  catch (error) {
    if (!(error instanceof DataError) || !['OPENING_TIME', 'TIME_PREFLIGHT'].includes(error.code)) throw error;
    const useVariables = variablesChooseOpening(effective);
    const raw = story.variableGuideRaw;
    // The optional notes parser deliberately drops invalid hint batches. On the Story
    // clock path alone, recover its safe failure category without accepting those hints.
    const discarded = !useVariables && story.variableGuide.length === 0 && raw?.trim()
      ? parseStoryGuide(raw).failureRule : undefined;
    const rule = discarded ?? (error instanceof StoryValidationError ? error.diagnostic.storyRule : undefined);
    const reason = openingTimeFailureReasons.find(value => value === rule)
      ?? (rule === 'guide_json' ? 'opening_json' : error.code === 'TIME_PREFLIGHT' ? 'opening_protocol' : 'opening_format');
    const hasVariableClock = commands.some(command => command.type === 'SetWorldClock');
    const hasStoryClock = Boolean(discarded || story.variableGuide.some(entry => entry.group === 'time' && entry.subjectHint?.startsWith('time:')));
    const diagnostic: NonNullable<FailureDiagnostic['openingTime']> = {
      pending: true, useVariableStage, useWorldStage, reason,
      clockSource: useVariables ? (hasVariableClock ? 'variables' : 'none') : (hasStoryClock ? 'story' : 'none'),
    };
    return { error, diagnostic };
  }
}

export function requireOpeningSettlement(state: GameState, effective: TurnDraft) {
  const issue = openingSettlementIssue(state, effective);
  if (issue) {
    attachFailureDiagnostic(issue.error, { phase: 'commit_validation', openingTime: issue.diagnostic });
    throw issue.error;
  }
}

// 提交边界重新验证，不信任持久化 validated；同一事务内仅运行同步纯计算。
export function validateTurnCandidates(state: GameState, input: TurnDraft) {
  requireData(completeTurnDraft(input), 'TURN_INCOMPLETE', '正文或已启用阶段尚未完整完成');
  const draft = settlementDraft(input);
  requireOpeningSettlement(state, draft);
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
