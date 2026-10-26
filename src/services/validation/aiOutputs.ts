import { openingTimeBase } from '../../domain/openingTime';
import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands, fingerprint } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { validateWorldOutput } from './worldOutput';
import type { Settings } from '../../ui/settings/model';
import { variablePermission } from './evidence';
import { variableCommandsForTurn } from '../../domain/turnProjection';
import { variableValidationError } from './variableDiagnostics';
import { assessSummary } from '../../domain/memories/summary';
import { validateTimeCommands, validateHistoricalWorld } from '../../domain/timePreflight';

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
  const facts = checked.data.commands.map((command) => fingerprint({ ...command, commandId: '' }));
  if (new Set(facts).size !== facts.length) throw new AiError('candidate_conflict');
  const permissionState = {
    ...state,
    npc: {
      ...state.npc,
      ...Object.fromEntries(
        checked.data.commands.flatMap((command) =>
          command.type === 'CreateNpc' ? [[command.npc.id, command.npc]] : [],
        ),
      ),
    },
  };
  for (const command of checked.data.commands)
    if (command.type === 'UpdateNpc' && command.changes.onScene === true) {
      const person = permissionState.npc[command.npcId];
      if (person) permissionState.npc[command.npcId] = { ...person, onScene: true };
    }
  try {
    validateTimeCommands(timeState, draft, checked.data.commands);
    const interactions = new Set(checked.data.commands.flatMap((command) =>
      command.type === 'UpdateNpc' && command.changes.lastInteractionAt ? [command.npcId] : []));
    for (const command of checked.data.commands) variablePermission(command, permissionState, draft, interactions);
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
