import { storySceneAuthority, validateNarrationClock } from '../../domain/events/narration';
import { z } from 'zod';
import { commitCommands, fingerprint } from '../../domain/commands';
import { CommandDataError, DataError } from '../../domain/common';
import { validateSceneEventUpdate } from '../../domain/events/scenePermission';
import { preparedVariableCommands } from '../../domain/turnProjection';
import { openingTimeBase } from '../../domain/openingTime';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { compileVariableCommands } from './compile';
import { ExecutionContextSchema, failed } from './model';
import { aggregateDomainDiagnostic, isTimeDomainRule } from './aggregateDiagnostics';
import type { ExecutionResult, VariableExecutionContext, VariableExecutionPlan } from './model';
export { compileVariableCommands } from './compile';
export type { VariableExecutionContext, VariableExecutionPlan, ExecutionError, ExecutionErrorCode, ExecutionResult, CommandOrigin } from './model';

/** 绑定当前存档/草稿快照，确保模拟使用相同指令及版本；不审查剧情事实。 */
export async function simulateVariablePlan(plan: VariableExecutionPlan, state: GameState,
  context: VariableExecutionContext): Promise<ExecutionResult<GameState>> {
  try { return await simulateChecked(plan, state, context); }
  catch { return failed('transaction_failed'); }
}

async function simulateChecked(plan: VariableExecutionPlan, state: GameState,
  context: VariableExecutionContext): Promise<ExecutionResult<GameState>> {
  // 在首个await前冻结输入，调用方的后续对象修改不会偷换本次模拟。
  const stateCheck = GameStateSchema.safeParse(state), contextCheck = ExecutionContextSchema.safeParse(context);
  if (!stateCheck.success) return failed('domain_validation_failed');
  if (!contextCheck.success) return failed('type_mismatch');
  state = stateCheck.data; context = contextCheck.data;
  try { plan = structuredClone(plan); } catch { return failed('type_mismatch'); }
  const checked = await compileVariableCommands(plan.ast, state, context);
  if (!checked.ok) return checked;
  if (plan.version !== 1 || plan.contextDigest !== checked.value.contextDigest || plan.stateDigest !== checked.value.stateDigest)
    return failed('revision_conflict');
  if (fingerprint(plan.commands) !== fingerprint(checked.value.commands) || fingerprint(plan.origins) !== fingerprint(checked.value.origins))
    return failed('duplicate_or_conflicting_command');
  let commands: ReturnType<typeof preparedVariableCommands> = [];
  try {
    commands = preparedVariableCommands(state, context.draft, checked.value.commands);
    // 整份批次只调用一次；不以逐条commit产生中间revision，不使用设备当前时间。
    const projected = commitCommands(openingTimeBase(state, context.draft), context.draft.turnId,
      context.expectedRevision, commands, state.updatedAt,storySceneAuthority(state,context.draft,checked.value.commands));
    validateNarrationClock(state,context.draft,projected.worldClock);
    for (const [index, command] of checked.value.commands.entries()) {
      if (command.type !== 'SaveEvent') continue;
      try { validateSceneEventUpdate(state, projected, command.event, context.draft.turnId,context.draft.story); }
      catch (error) {
        if (!(error instanceof DataError) || error.code !== 'SCENE_PERMISSION') throw error;
        return failed('permission_denied', checked.value.origins[index], [], {
          ...aggregateDomainDiagnostic(error), commandType: 'SaveEvent', valuePath: 'events[id].sceneState',
        });
      }
    }
    return { ok: true, value: projected };
  } catch (error) {
    const related = checked.value.origins.filter((origin) => origin !== null);
    if (error instanceof z.ZodError)
      return failed('domain_validation_failed', null, related, aggregateDomainDiagnostic(error));
    if (error instanceof DataError) {
      const diagnostic = aggregateDomainDiagnostic(error);
      if (error instanceof CommandDataError && isTimeDomainRule(diagnostic.domainRule)) {
        const command = commands[error.commandIndex];
        const index = checked.value.commands.findIndex(c => c.commandId === command?.commandId);
        const origin = checked.value.origins[index];
        if (origin && command) return failed('domain_validation_failed', origin, [], { ...diagnostic, commandType: command.type });
      }
      const code = ['REVISION_CONFLICT', 'ENTITY_CONFLICT'].includes(error.code) ? 'revision_conflict'
        : ['DUPLICATE_COMMAND', 'COMMAND_CONFLICT', 'DUPLICATE_MEMORY'].includes(error.code) ? 'duplicate_or_conflicting_command'
        : ['UNKNOWN_BALANCE', 'INSUFFICIENT_FUNDS'].includes(error.code) ? 'invalid_amount'
        : ['OWNERSHIP', 'KNOWLEDGE_KIND', 'MEMORY_SOURCE', 'SCENE_PERMISSION'].includes(error.code) ? 'permission_denied'
        : 'domain_validation_failed';
      return failed(code, null, related, diagnostic);
    }
    return failed('transaction_failed', null, related);
  }
}
