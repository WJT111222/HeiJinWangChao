import { z } from 'zod';
import { commitCommands, fingerprint } from '../../domain/commands';
import { DataError } from '../../domain/common';
import { openingTimeBase } from '../../domain/openingTime';
import { GameStateSchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { compileVariableCommands } from './compile';
import { ExecutionContextSchema, failed } from './model';
import type { ExecutionResult, VariableExecutionContext, VariableExecutionPlan } from './model';
export { compileVariableCommands } from './compile';
export type { VariableExecutionContext, VariableExecutionPlan, ExecutionError, ExecutionErrorCode, ExecutionResult, CommandOrigin } from './model';

/** 不信任可序列化计划本身的授权；必须重新提供当前可信上下文，重编译后才整批模拟。 */
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
  if (!contextCheck.success) return failed('missing_provenance');
  state = stateCheck.data; context = contextCheck.data;
  try { plan = structuredClone(plan); } catch { return failed('type_mismatch'); }
  const checked = await compileVariableCommands(plan.ast, state, context);
  if (!checked.ok) return checked;
  if (plan.version !== 1 || plan.contextDigest !== checked.value.contextDigest || plan.stateDigest !== checked.value.stateDigest)
    return failed('revision_conflict');
  if (fingerprint(plan.commands) !== fingerprint(checked.value.commands) || fingerprint(plan.origins) !== fingerprint(checked.value.origins))
    return failed('duplicate_or_conflicting_command');
  try {
    // 整份批次只调用一次；不以逐条commit产生中间revision，不使用设备当前时间。
    return { ok: true, value: commitCommands(openingTimeBase(state, context.draft), context.draft.turnId,
      context.expectedRevision, checked.value.commands, state.updatedAt) };
  } catch (error) {
    const related = checked.value.origins.filter((origin) => origin !== null);
    if (error instanceof z.ZodError) return failed('domain_validation_failed', null, related);
    if (error instanceof DataError) {
      const code = ['REVISION_CONFLICT', 'ENTITY_CONFLICT'].includes(error.code) ? 'revision_conflict'
        : ['DUPLICATE_COMMAND', 'COMMAND_CONFLICT', 'DUPLICATE_MEMORY'].includes(error.code) ? 'duplicate_or_conflicting_command'
        : ['UNKNOWN_BALANCE', 'INSUFFICIENT_FUNDS'].includes(error.code) ? 'invalid_amount'
        : ['OWNERSHIP', 'KNOWLEDGE_KIND', 'MEMORY_SOURCE'].includes(error.code) ? 'permission_denied'
        : 'domain_validation_failed';
      return failed(code, null, related);
    }
    return failed('transaction_failed', null, related);
  }
}
