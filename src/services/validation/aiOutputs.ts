import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands, fingerprint } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { validateWorldOutput } from './worldOutput';
import type { Settings } from '../../ui/settings/model';
import { economicAmount, factEvidence, variablePermission, completedPayment } from './evidence';
import { assessSummary } from '../../domain/memories/summary';
import { validateTimeCommands, validateHistoricalWorld } from '../../domain/timePreflight';

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError('invalid_json');
  }
}
export function parseStory(text: string, mode: 'opening' | 'regular', settings: Settings) {
  const actions = settings.prompts.actionOptions;
  const pattern = actions
    ? /^\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*<行动选项>([\s\S]*?)<\/行动选项>\s*$/
    : /^\s*<正文>([\s\S]*?)<\/正文>\s*<短期记忆>([\s\S]*?)<\/短期记忆>\s*<变量规划>([\s\S]*?)<\/变量规划>\s*$/;
  const match = text.match(pattern);
  if (
    !match ||
    /<\/?(?:thinking|think|judge)\b[^>]*>/i.test(text) ||
    match.slice(1).some((part) => /<\/?(?:正文|短期记忆|变量规划|行动选项)>/.test(part))
  )
    throw new AiError('invalid_output');
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
  return parsed.data;
}
export function checkMoneyEvidence(command: DomainCommand) {
  const amount = economicAmount(command);
  const matches = [...command.evidence.matchAll(/(\d+(?:\.\d{1,2})?)\s*(元|分)/g)];
  // 只对一处明确货币证据比较；复杂报价/多金额不臆测事实对应关系。
  if (amount === undefined || matches.length !== 1) return;
  const [, value, unit] = matches[0];
  const [integer, fraction = ''] = value.split('.');
  const cents =
    unit === '元'
      ? BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'))
      : !fraction
        ? BigInt(integer)
        : -1n;
  if (cents !== BigInt(amount)) throw new AiError('money_unit');
}
function evidenceCheck(command: DomainCommand, facts: string) {
  if (!facts.includes(command.evidence)) throw new AiError('invalid_output');
  checkMoneyEvidence(command);
}
function simulate(state: GameState, turnId: string, commands: DomainCommand[]) {
  try {
    return commitCommands(state, turnId, state.revision, commands, state.updatedAt);
  } catch {
    throw new AiError('invalid_output');
  }
}
export function parseVariables(text: string, state: GameState, draft: TurnDraft) {
  const checked = VariableResultSchema.safeParse(json(text));
  if (!checked.success || !draft.story) throw new AiError('invalid_output');
  const facts = checked.data.commands.map((command) => fingerprint({ ...command, commandId: '' }));
  if (new Set(facts).size !== facts.length) throw new AiError('invalid_output');
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
  try { validateTimeCommands(state, draft, checked.data.commands); }
  catch { throw new AiError('time_preflight'); }
  for (const command of checked.data.commands) {
    evidenceCheck(command, draft.story.narrative);
    factEvidence(command, draft.story.narrative);
    completedPayment(command);
    variablePermission(command, permissionState, draft);
  }
  simulate(state, draft.turnId, checked.data.commands);
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
