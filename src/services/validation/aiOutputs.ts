import { nestedStoryTag, storyEnvelopeDiagnostic, storySchemaError } from './storyDiagnostics';
import { validateSceneEventUpdate } from '../../domain/events/scenePermission';
import { openingTimeBase } from '../../domain/openingTime';
import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { validateWorldOutput } from './worldOutput';
import { worldValidationError } from './worldDiagnostics';
import type { Settings } from '../../ui/settings/model';
import { preparedVariableCommands } from '../../domain/turnProjection';
import { variableFailure, variableValidationError } from './variableDiagnostics';
import { assessSummary } from '../../domain/memories/summary';
import { validateTimeCommands, validateHistoricalWorld } from '../../domain/timePreflight';
import { parseVariableText, parseVariableResponse } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import type { ExecutionError } from '../../executors/variableText';

function textExecutionError(error: ExecutionError, variableStep: 'mapping' | 'simulation') {
  const code = error.code === 'transaction_failed' ? 'variable_runtime' : error.code === 'invalid_amount' ? 'amount_balance'
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
  const context = { draft, expectedRevision: state.revision };
  const compiled = await compileVariableCommands(ast.value, state, context);
  if (!compiled.ok) throw textExecutionError(compiled.error, 'mapping');
  try { validateTimeCommands(state, draft, compiled.value.commands); }
  catch (error) { throw variableFailure(error, 'simulation'); }
  const simulated = await simulateVariablePlan(compiled.value, state, context);
  if (!simulated.ok) throw textExecutionError(simulated.error, 'simulation');
  // 复用正式提交已有的场景权限底线；文本任务/事件不能冒充World后台操作。
  try {
  for (const [commandIndex, command] of compiled.value.commands.entries()) {
    if (command.type === 'SaveEvent') validateSceneEventUpdate(state, simulated.value, command.event, draft.turnId);
    const actors = command.type === 'SaveTask' ? [command.task.actorRef] : [];
    if (actors.some((actor) => actor.kind === 'npc' && !simulated.value.npc[actor.id]?.onScene))
      throw new AiError('data_integrity', undefined, { fieldPath: 'commands.actorRef', commandIndex, commandType: command.type });
  }
  // 分析及说明只保留于临时原文；不将它们提升成已执行事实。
  return VariableResultSchema.parse({ commands: compiled.value.commands, rejectedSuggestions: [],
    unresolved: envelope.value.description.trim() ? ['模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。'] : [] });
  } catch (error) { throw variableFailure(error, 'simulation'); }
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('invalid_json');
  }
}
/** Strip only a whole World JSON fence, never extract/repair a partial object. */
function worldJson(text: string): unknown {
  const trimmed = text.trim();
  const opening = /^```(?:json)?[ \t]*\r?\n/i.exec(trimmed);
  if (!opening) return json(text);
  const body = trimmed.slice(opening[0].length).replace(/\r?\n```[ \t]*$/, '');
  return json(body);
}
// 只解析结构；叙事规划不属于 StorySchema，也不检查文学步骤的内容质量。
export function parseStoryEnvelope(text: string, mode: 'opening' | 'regular', settings: Settings) {
  const actions = settings.prompts.actionOptions;
  const pattern = actions
    ? /^\s*<thinking>([\s\S]*?)<\/thinking>\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*<行动选项>([\s\S]*?)<\/行动选项>\s*$/
    : /^\s*<thinking>([\s\S]*?)<\/thinking>\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*$/;
  const envelope = text.match(pattern);
  if (!envelope) throw new AiError('invalid_output', undefined, storyEnvelopeDiagnostic(text, actions));
  if (!envelope[1].trim()) throw new AiError('invalid_output', undefined, { storyRule: 'planning_empty', storyTag: 'thinking' });
  const nested = envelope.slice(1).map(nestedStoryTag).find(Boolean);
  if (nested) throw new AiError('invalid_output', undefined, { storyRule: 'tag_nested', storyTag: nested });
  const planning = envelope[1].trim();
  const match = envelope.slice(1);
  const narrative = match[1].trim();
  const summary = match[2].trim();
  // 100～200 汉字为质量目标，偏离仅提示；空摘要不能充当有效的本回合事实记录。
  if (assessSummary(summary).status === 'empty') throw new AiError('invalid_output', undefined, { storyRule: 'summary_empty', storyTag: '短期记忆' });
  const narrativeChars = Array.from(narrative.replace(/\s/gu, '')).length;
  if (narrativeChars < settings.prompts.minNarrativeChars)
    throw new AiError('invalid_output', undefined, { storyRule: 'narrative_short', actualCount: narrativeChars, minimumCount: settings.prompts.minNarrativeChars });
  const actionOptions = actions
    ? match[4]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : undefined;
  if (actions && (!actionOptions || actionOptions.length < 3 || actionOptions.length > 5))
    throw new AiError('invalid_output', undefined, { storyRule: 'actions_count', actualCount: actionOptions?.length ?? 0, minimumCount: 3, maximumCount: 5 });
  let variableGuide: unknown;
  try { variableGuide = json(match[3]); }
  catch { throw new AiError('invalid_json', undefined, { storyRule: 'guide_json', storyTag: '变量规划' }); }
  const parsed = StorySchema.safeParse({
    turnKind: mode,
    narrative,
    summary,
    variableGuide,
    ...(actions ? { actionOptions } : {}),
  });
  if (!parsed.success) throw storySchemaError(parsed.error);
  return { story: parsed.data, planning };
}
export function parseStory(text: string, mode: 'opening' | 'regular', settings: Settings) {
  return parseStoryEnvelope(text, mode, settings).story;
}
export function parseVariables(text: string, state: GameState, draft: TurnDraft) {
  const timeState = state;
  const raw = json(text);
  const checked = VariableResultSchema.safeParse(raw);
  if (!checked.success) throw variableValidationError(checked.error, raw);
  if(checked.data.commands.some(c=>c.type==='DeleteEvent'||c.type==='ArchiveEvent'))throw new AiError('permission');
  if (!draft.story) throw new AiError('candidate_conflict');
  try { state = openingTimeBase(state, draft); } catch (error) { throw variableValidationError(error); }
  if (new Set(checked.data.commands.map((c) => c.commandId)).size !== checked.data.commands.length) throw new AiError('candidate_conflict');
  try {
    validateTimeCommands(timeState, draft, checked.data.commands);
    const projected = commitCommands(state, draft.turnId, state.revision, preparedVariableCommands(timeState, draft, checked.data.commands), state.updatedAt);
    for (const command of checked.data.commands)
      if (command.type === 'SaveEvent') validateSceneEventUpdate(state, projected, command.event, draft.turnId);
  } catch (error) { throw variableValidationError(error); }
  return checked.data;
}
export function parseWorld(text: string, state: GameState, draft: TurnDraft) {
  if (draft.variables?.validation === 'validated')
    parseVariables(JSON.stringify(draft.variables.result), state, draft);
  try {
    const result = validateWorldOutput(worldJson(text), state, draft);
    try { validateHistoricalWorld(state, draft, result); } catch { throw new AiError('time_preflight'); }
    return result;
  } catch (error) {
    throw worldValidationError(error);
  }
}
