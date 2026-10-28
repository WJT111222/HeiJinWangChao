import { openingTimeBase } from '../../domain/openingTime';
import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { validateWorldOutput } from './worldOutput';
import type { Settings } from '../../ui/settings/model';
import { variableCommandsForTurn } from '../../domain/turnProjection';
import { variableValidationError } from './variableDiagnostics';
import { assessSummary } from '../../domain/memories/summary';
import { validateTimeCommands, validateHistoricalWorld } from '../../domain/timePreflight';
import { parseVariableText, extractCommandBlock } from '../../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../../executors/variableText';
import type { ExecutionError } from '../../executors/variableText';

function textExecutionError(error: ExecutionError) {
  const code = error.code === 'invalid_amount' ? 'amount_balance'
    : ['revision_conflict', 'duplicate_or_conflicting_command'].includes(error.code) ? 'candidate_conflict'
    : ['unsupported_path', 'unsupported_operation', 'type_mismatch'].includes(error.code) ? 'schema_fields' : 'data_integrity';
  return new AiError(code, undefined, { fieldPath: `text.${error.code}`,
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
  const ast = parseVariableText(text);
  if (!ast.ok) throw new AiError('variable_text_syntax', undefined, {
    fieldPath: `text.${ast.error.code}.line${ast.error.position.line}.column${ast.error.position.column}`,
    ...(ast.error.commandIndex === null ? {} : { commandIndex: ast.error.commandIndex - 1 }) });
  const context = { draft, expectedRevision: state.revision };
  const compiled = await compileVariableCommands(ast.value, state, context);
  if (!compiled.ok) throw textExecutionError(compiled.error);
  try { validateTimeCommands(state, draft, compiled.value.commands); }
  catch (error) { throw variableValidationError(error); }
  const simulated = await simulateVariablePlan(compiled.value, state, context);
  if (!simulated.ok) throw textExecutionError(simulated.error);
  // 复用正式提交已有的场景权限底线；文本任务/事件不能冒充World后台操作。
  for (const [commandIndex, command] of compiled.value.commands.entries()) {
    const actors = command.type === 'SaveTask' ? [command.task.actorRef]
      : command.type === 'SaveEvent' ? command.event.actorRefs : [];
    if (actors.some((actor) => actor.kind === 'npc' && !simulated.value.npc[actor.id]?.onScene))
      throw new AiError('data_integrity', undefined, { fieldPath: 'commands.actorRef', commandIndex, commandType: command.type });
  }
  const block = extractCommandBlock(text);
  // 说明只产生固定安全提示，不复制私有内容、密钥、未知建议或模型原文到候选/日志。
  const outside = block.ok ? text.slice(0, block.value.source.start.offset) + text.slice(block.value.source.end.offset) : '';
  return VariableResultSchema.parse({ commands: compiled.value.commands, rejectedSuggestions: [],
    unresolved: outside.includes('<说明>') ? ['模型附带非执行说明；说明未转为命令或存档事实，只有列出的领域命令通过模拟。'] : [] });
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('invalid_json');
  }
}
// 只解析结构；叙事规划不属于 StorySchema，也不检查文学步骤的内容质量。
export function parseStoryEnvelope(text: string, mode: 'opening' | 'regular', settings: Settings) {
  const actions = settings.prompts.actionOptions;
  const pattern = actions
    ? /^\s*<thinking>([\s\S]*?)<\/thinking>\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*<行动选项>([\s\S]*?)<\/行动选项>\s*$/
    : /^\s*<thinking>([\s\S]*?)<\/thinking>\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*$/;
  const envelope = text.match(pattern);
  if (!envelope || !envelope[1].trim() || envelope.slice(1).some((part) =>
    /<\s*\/?\s*(?:thinking|think|judge|正文|短期记忆|变量规划|行动选项)(?=[\s/>])[^>]*>/i.test(part)))
    throw new AiError('invalid_output');
  const planning = envelope[1].trim();
  const match = envelope.slice(1);
  const narrative = match[1].trim();
  const summary = match[2].trim();
  // 100～200 汉字为质量目标，偏离仅提示；空摘要不能充当有效的本回合事实记录。
  if (assessSummary(summary).status === 'empty') throw new AiError('invalid_output');
  if (Array.from(narrative.replace(/\s/gu, '')).length < settings.prompts.minNarrativeChars)
    throw new AiError('invalid_output');
  const actionOptions = actions
    ? match[4]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : undefined;
  if (actions && (!actionOptions || actionOptions.length < 3 || actionOptions.length > 5))
    throw new AiError('invalid_output');
  const parsed = StorySchema.safeParse({
    turnKind: mode,
    narrative,
    summary,
    variableGuide: json(match[3]),
    ...(actions ? { actionOptions } : {}),
  });
  if (!parsed.success) throw new AiError('invalid_output');
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
  if (!draft.story) throw new AiError('candidate_conflict');
  try { state = openingTimeBase(state, draft); } catch (error) { throw variableValidationError(error); }
  if (new Set(checked.data.commands.map((c) => c.commandId)).size !== checked.data.commands.length) throw new AiError('candidate_conflict');
  try {
    validateTimeCommands(timeState, draft, checked.data.commands);
    commitCommands(state, draft.turnId, state.revision, variableCommandsForTurn(timeState, draft, checked.data.commands), state.updatedAt);
  } catch (error) { throw variableValidationError(error); }
  return checked.data;
}
export function parseWorld(text: string, state: GameState, draft: TurnDraft) {
  if (draft.variables?.validation === 'validated')
    parseVariables(JSON.stringify(draft.variables.result), state, draft);
  try {
    const result = validateWorldOutput(json(text), state, draft);
    try { validateHistoricalWorld(state, draft, result); } catch { throw new AiError('time_preflight'); }
    return result;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError('invalid_output');
  }
}
