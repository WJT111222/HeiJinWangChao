import { checkEntityCommands } from '../../domain/entityCandidate';
import { IdSchema } from '../../domain/common';
import { commandsForPhase } from '../../domain/stageCommands';
import { hasVisibleNarrative } from '../../domain/storyContent';
import { storySceneAuthority, validateNarrationClock } from '../../domain/events/narration';
import { nestedStoryTag, storyEnvelopeDiagnostic, storySchemaError } from './storyDiagnostics';
import { recoverStoryEnvelope, repairUnclosedTags } from './storyEnvelopeRecovery';
import { attachFailureDiagnostic, scanStoryTags } from '../ai/failureDiagnostic';
import type { FailureDiagnostic } from '../ai/failureDiagnostic';
import { parseStoryGuide } from './storyGuide';
import { validateVariableWork } from './variableWork';
import { validateSceneEventUpdate } from '../../domain/events/scenePermission';
import { openingTimeBase } from '../../domain/openingTime';
import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands, fingerprint } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { validateWorldOutput } from './worldOutput';
import { worldValidationError } from './worldDiagnostics';
import type { Settings } from '../../ui/settings/model';
import { prepareVariableProjection } from '../../domain/turnProjection';
import { variableFailure, variableValidationError } from './variableDiagnostics';
import { assessSummary } from '../../domain/memories/summary';
import { validateTimeCommands, validateHistoricalWorld } from '../../domain/timePreflight';
import type { ParsedVariableCommand } from '../../parsers/variableText';
import { parseVariableText, parseVariableResponse } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import type { ExecutionError } from '../../executors/variableText';
import { isTimeDomainRule } from '../../executors/variableText/aggregateDiagnostics';

function textExecutionError(error: ExecutionError, variableStep: 'mapping' | 'simulation') {
  const code = isTimeDomainRule(error.diagnostic?.domainRule) ? 'time_data'
    : error.code === 'transaction_failed' ? 'variable_runtime' : error.code === 'invalid_amount' ? 'amount_balance'
    : ['revision_conflict', 'duplicate_or_conflicting_command'].includes(error.code) ? 'candidate_conflict'
    : ['unsupported_path', 'unsupported_operation', 'type_mismatch'].includes(error.code) ? 'schema_fields' : 'data_integrity';
  return new AiError(code, undefined, { variableStep, fieldPath: `text.${error.code}`,
    ...(error.commandIndex === null ? {} : { commandIndex: error.commandIndex - 1 }),
    // 整批失败时不能指认某一条：只暴露相关命令序号，不复制原始变量或实体 ID。
    ...(error.commandIndex === null && error.relatedCommands.length
      ? { relatedCommandIndices: [...new Set(error.relatedCommands.map((origin) => origin.commandIndex))].slice(0, 20) }
      : {}),
    // Compiler-created metadata contains only normalized paths / type names / fixed rules.
    ...(error.diagnostic ?? {}) });
}
/** 新模型响应只允许文本协议。旧JSON仅由下方parseVariables复核已保存的领域候选。 */
export async function parseTextVariables(text: string, state: GameState, draft: TurnDraft) {
  const envelope = parseVariableResponse(text);
  if (!envelope.ok) throw new AiError('variable_text_syntax', undefined, { variableStep: 'envelope', fieldPath: `text.${envelope.error.code}` });
  const ast = parseVariableText(text);
  if (!ast.ok) throw new AiError('variable_text_syntax', undefined, {
    variableStep: 'commands', fieldPath: `text.${ast.error.code}.line${ast.error.position.line}.column${ast.error.position.column}`,
    ...(ast.error.commandIndex === null ? {} : { commandIndex: ast.error.commandIndex - 1 }) });
  return validateVariableStatements(ast.value, state, draft, Boolean(envelope.value.description.trim()));
}

export function entityEnvelope(text: string) {
  const tag = /^\s*<接触者>([^<]*)<\/接触者>/u.exec(text);
  const declared = tag ? IdSchema.array().safeParse(json(tag[1])) : undefined;
  if (declared && !declared.success) throw new AiError('schema_fields');
  return { contactedNpcIds: declared?.data ?? [], text: tag ? text.slice(tag[0].length) : text };
}

export async function parseEntities(text: string, state: GameState, draft: TurnDraft) {
  const envelope = entityEnvelope(text);
  const ast = parseVariableText(envelope.text);
  if (!ast.ok) throw new AiError('variable_text_syntax', undefined, { variableStep: 'commands' });
  const result = await validateEntityStatements(ast.value, state, draft, envelope.contactedNpcIds);
  return { ...result, contactedNpcIds: envelope.contactedNpcIds };
}

export async function validateEntityStatements(ast: readonly ParsedVariableCommand[], state: GameState, draft: TurnDraft, contactedNpcIds: string[]) {
  const plan = await compileVariableCommands(ast, state, { draft, expectedRevision: state.revision, phase: 'entities' });
  if (!plan.ok) throw textExecutionError(plan.error, 'mapping');
  // System opening clocks belong to the scene/Story path, never to this candidate.
  const commands = plan.value.commands.filter((_, index) => plan.value.origins[index] !== null);
  try { checkEntityCommands(state, draft, contactedNpcIds, commands); }
  catch (error) { throw variableFailure(error, 'simulation'); }
  return VariableResultSchema.parse({ commands, rejectedSuggestions: [], unresolved: [] });
}

export async function validateVariableStatements(ast: readonly ParsedVariableCommand[], state: GameState, draft: TurnDraft, hasDescription: boolean, sceneOnly = false) {
  const context = { draft, expectedRevision: state.revision };
  const compiled = await compileVariableCommands(ast, state, context);
  if (!compiled.ok) throw textExecutionError(compiled.error, 'mapping');
  if (sceneOnly || draft.requestedStages.includes('variables')) {
    const allowed = new Set(commandsForPhase('scene', draft.turnKind));
    for (const [index, command] of compiled.value.commands.entries())
      if (!allowed.has(command.type)) throw new AiError('permission', undefined, { commandIndex: index, commandType: command.type });
  }
  try { validateTimeCommands(state, draft, compiled.value.commands); }
  catch (error) { throw variableFailure(error, 'simulation'); }
  const simulated = await simulateVariablePlan(compiled.value, state, context);
  if (!simulated.ok) throw textExecutionError(simulated.error, 'simulation');
  for (const [index, command] of compiled.value.commands.entries()) {
    try { validateVariableWork(state, draft, simulated.value, command); }
    catch (error) {
      const failure = variableFailure(error, 'simulation');
      const origin = compiled.value.origins[index];
      throw new AiError(failure.code, failure.status, { ...failure.details, commandType: command.type,
        ...(origin ? { commandIndex: origin.commandIndex - 1 } : {}) });
    }
  }
  // Analysis and descriptions are non-executable and remain in the transient inspection.
  return VariableResultSchema.parse({ commands: compiled.value.commands, rejectedSuggestions: [],
    unresolved: hasDescription ? ['模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。'] : [] });
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('invalid_json');
  }
}
/** Strip only a whole World JSON fence, never extract/repair a partial object. */
export function worldJson(text: string): unknown {
  const trimmed = text.trim();
  const opening = /^```(?:json)?[ \t]*\r?\n/i.exec(trimmed);
  if (!opening) return json(text);
  const body = trimmed.slice(opening[0].length).replace(/\r?\n```[ \t]*$/u, '');
  return json(body);
}
// 只解析结构；叙事规划不属于 StorySchema，也不检查文学步骤的内容质量。
// 可选项目规划与确定性标签恢复只影响封套解析，原文仍在临时原文视图保留。
export function parseStoryEnvelope(text: string, mode: 'opening' | 'regular', settings: Settings, minimum: number | null = settings.prompts.minNarrativeChars) {
  const actions = settings.prompts.actionOptions;
  const pattern = actions
    ? /^\s*(?:<thinking>([\s\S]*?)<\/thinking>\s*)?<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*(?:<变量规划>([\s\S]*?)<\/变量规划>)?\s*<行动选项>([\s\S]*?)<\/行动选项>\s*$/
    : /^\s*(?:<thinking>([\s\S]*?)<\/thinking>\s*)?<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*(?:<变量规划>([\s\S]*?)<\/变量规划>)?\s*$/;
  // 顺序：严格解析（含 #149 的双正文标签缺失恢复）→ 漏写闭合标签的确定性补全；诊断仍基于原始输出。
  const recovered = recoverStoryEnvelope(text, actions);
  const primary = (recovered ?? text).match(pattern);
  const repaired = primary ? undefined : repairUnclosedTags(text, actions);
  const repairedMatch = repaired?.match(pattern);
  const envelope = primary ?? repairedMatch;
  const strict = text.match(pattern);
  const strictMatched = strict !== null;
  const recoverMatched = recovered !== undefined && primary !== null;
  const repairMatched = repairedMatch != null;
  let rule: NonNullable<FailureDiagnostic['recovery']>['rule'];
  let reason: NonNullable<FailureDiagnostic['recovery']>['reason'];
  if (strictMatched) reason = 'not_needed';
  else if (recoverMatched) rule = 'missing_body_delimiters';
  else if (repairMatched) rule = 'unclosed_tags';
  else if (recovered !== undefined || repaired !== undefined) {
    reason = 'rule_mismatch';
    rule = recovered !== undefined ? 'missing_body_delimiters' : 'unclosed_tags';
  } else reason = 'not_applicable';
  const recovery = {
    attempted: !strictMatched, ...(rule ? { rule } : {}), succeeded: !strictMatched && Boolean(envelope), ...(reason ? { reason } : {}),
  };
  function fail(error: AiError): never {
    attachFailureDiagnostic(error, { phase: 'story_validation', storyTags: scanStoryTags(text, actions), parseInputChars: text.length, recovery });
    throw error;
  }
  if (!envelope) fail(new AiError('invalid_output', undefined, storyEnvelopeDiagnostic(text, actions)));
  if (envelope[1] !== undefined && !envelope[1].trim())
    fail(new AiError('invalid_output', undefined, { storyRule: 'planning_empty', storyTag: 'thinking' }));
  const nested = envelope.slice(1).filter((part): part is string => part !== undefined).map(nestedStoryTag).find(Boolean);
  if (nested) fail(new AiError('invalid_output', undefined, { storyRule: 'tag_nested', storyTag: nested }));
  const planning = envelope[1]?.trim() ?? '';
  const narrative = envelope[2].trim();
  const summary = envelope[3].trim();
  // 100～200 汉字为质量目标，偏离仅提示；空摘要不能充当有效的本回合事实记录。
  if (assessSummary(summary).status === 'empty') fail(new AiError('invalid_output', undefined, { storyRule: 'summary_empty', storyTag: '短期记忆' }));
  if (!hasVisibleNarrative(narrative))
    fail(new AiError('invalid_output', undefined, { storyRule: 'narrative_empty', storyTag: '正文' }));
  const narrativeChars = Array.from(narrative.replace(/\s/gu, '')).length;
  if (minimum !== null && narrativeChars < minimum)
    fail(new AiError('invalid_output', undefined, { storyRule: 'narrative_short', actualCount: narrativeChars, minimumCount: minimum }));
  const actionOptions = actions
    ? envelope[5]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : undefined;
  if (actions && (!actionOptions || actionOptions.length < 3 || actionOptions.length > 5))
    fail(new AiError('invalid_output', undefined, { storyRule: 'actions_count', actualCount: actionOptions?.length ?? 0, minimumCount: 3, maximumCount: 5 }));
  const { notes, guide } = parseStoryGuide(envelope[4] ?? '');
  const parsed = StorySchema.safeParse({
    turnKind: mode,
    narrative,
    summary,
    ...guide,
    ...(actions ? { actionOptions } : {}),
  });
  if (!parsed.success) fail(storySchemaError(parsed.error));
  return { story: parsed.data, planning, notes };
}
export function parseStory(text: string, mode: 'opening' | 'regular', settings: Settings) {
  return parseStoryEnvelope(text, mode, settings).story;
}
export function parseVariables(text: string, state: GameState, draft: TurnDraft) {
  const timeState = state;
  const raw = json(text);
  const checked = VariableResultSchema.safeParse(raw);
  if (!checked.success) throw variableValidationError(checked.error, raw);
  if (checked.data.settlement && checked.data.settlement.accepted !== checked.data.commands.filter(command => command.commandId.startsWith('text-v1:')).length) throw new AiError('candidate_conflict');
  if (checked.data.commands.some(c => c.type === 'DeleteEvent' || c.type === 'RecordHistory')) throw new AiError('permission');
  if (!draft.story) throw new AiError('candidate_conflict');
  try { state = openingTimeBase(state, draft, checked.data.commands); } catch (error) { throw variableValidationError(error); }
  if (new Set(checked.data.commands.map((c) => c.commandId)).size !== checked.data.commands.length) throw new AiError('candidate_conflict');
  try {
    validateTimeCommands(timeState, draft, checked.data.commands);
    const prepared = prepareVariableProjection(timeState, draft, checked.data.commands);
    const projected = commitCommands(state, draft.turnId, state.revision, prepared.commands, state.updatedAt,
      storySceneAuthority(timeState,draft,checked.data.commands), prepared.acknowledgedReceipts);
    validateNarrationClock(timeState,draft,projected.worldClock);
    for (const command of checked.data.commands)
      if (command.type === 'SaveEvent') validateSceneEventUpdate(state, projected, command.event, draft.turnId,draft.story);
  } catch (error) { throw variableValidationError(error); }
  return checked.data;
}
export function validateWorldCandidate(raw: unknown, state: GameState, draft: TurnDraft, allowDeferred = false) {
  try {
    const result = validateWorldOutput(raw, state, draft, allowDeferred);
    try { validateHistoricalWorld(state, draft, result); } catch { throw new AiError('time_preflight'); }
    return result;
  } catch (error) {
    throw worldValidationError(error);
  }
}
export function parseWorld(text: string, state: GameState, draft: TurnDraft) {
  if (draft.variables?.validation === 'validated')
    parseVariables(JSON.stringify(draft.variables.result), state, draft);
  let raw: unknown;
  try { raw = worldJson(text); } catch (error) { throw worldValidationError(error); }
  if (raw && typeof raw === 'object' && ('settlement' in raw || 'deferredEvents' in raw))
    throw new AiError('invalid_output', undefined, { worldRule: 'command_structure' });
  return validateWorldCandidate(raw, state, draft);
}
export function revalidateWorld(state: GameState, draft: TurnDraft) {
  const { settlement, deferredEvents, ...commands } = draft.world!.result;
  const result = validateWorldCandidate(commands, state, draft, Boolean(deferredEvents));
  if (fingerprint(result.deferredEvents) !== fingerprint(deferredEvents))
    throw new AiError('candidate_conflict');
  if (settlement && settlement.accepted !== result.worldCommands.length + result.taskCommands.length + result.eventCommands.length)
    throw new AiError('candidate_conflict');
  return { ...result, ...(settlement ? { settlement } : {}) };
}
