import { StorySchema } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { VariableResultSchema, WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import { commitCommands } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import { AiError } from '../ai/errors';
import { worldTypes } from './commandCatalog';
import type { Settings } from '../../ui/settings/model';

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
    summary: match[2].trim(),
    variableGuide: json(match[3]),
    ...(actions ? { actionOptions } : {}),
  });
  if (!parsed.success) throw new AiError('invalid_output');
  return parsed.data;
}
export function checkMoneyEvidence(command: DomainCommand) {
  const amount =
    command.type === 'PurchaseItem' || command.type === 'PurchaseVehicle'
      ? command.price
      : command.type === 'TransferFunds' || command.type === 'RepayDebt'
        ? command.amount
        : command.type === 'ReceiveIncome'
          ? command.income.amount
          : command.type === 'Borrow'
            ? command.debt.principal
            : undefined;
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
  for (const command of checked.data.commands) {
    evidenceCheck(command, draft.story.narrative);
    if (command.type === 'CreateNpc' && !command.npc.onScene) throw new AiError('permission');
  }
  simulate(state, draft.turnId, checked.data.commands);
  return checked.data;
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
export function parseWorld(text: string, state: GameState, draft: TurnDraft) {
  const checked = WorldResultSchema.safeParse(json(text));
  if (!checked.success || !draft.story) throw new AiError('invalid_output');
  const result = checked.data;
  const base =
    draft.variables?.validation === 'validated'
      ? simulate(state, draft.turnId, draft.variables.result.commands)
      : state;
  const isSceneNpc = (id: string) => base.npc[id]?.onScene === true;
  for (const command of result.worldCommands) {
    if (!(worldTypes as readonly string[]).includes(command.type)) throw new AiError('permission');
    if (command.type === 'CreateNpc' && command.npc.onScene) throw new AiError('permission');
  }
  for (const command of result.taskCommands) {
    if (
      command.type !== 'SaveTask' ||
      command.task.actorRef.kind === 'protagonist' ||
      (command.task.actorRef.kind === 'npc' && isSceneNpc(command.task.actorRef.id))
    )
      throw new AiError('permission');
  }
  for (const command of result.eventCommands)
    if (command.type !== 'SaveEvent') throw new AiError('permission');
  const events = [
    ...result.futureEvents,
    ...result.eventCommands.flatMap((c) => (c.type === 'SaveEvent' ? [c.event] : [])),
  ];
  if (new Set(events.map((e) => e.id)).size !== events.length) throw new AiError('invalid_output');
  if (
    events.some((event) => event.actorRefs.some((ref) => ref.kind === 'npc' && isSceneNpc(ref.id)))
  )
    throw new AiError('permission');
  const facts = [
    draft.story.narrative,
    ...strings(Object.values(base.tasks)),
    ...strings(Object.values(base.events)),
    ...strings(Object.values(base.npc).filter((npc) => !npc.onScene)),
    ...strings(base.organizations),
  ].join('\n');
  const commands = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
  for (const command of commands) evidenceCheck(command, facts);
  const future = result.futureEvents.map((event): DomainCommand => ({
    commandId: `future:${event.id}`,
    type: 'SaveEvent',
    event,
    evidence: '后台事件候选结构验证',
  }));
  const projected = simulate(base, draft.turnId, [...commands, ...future]);
  if (
    result.timelineCandidates.some(
      (id) =>
        projected.events[id]?.status !== 'resolved' || projected.events[id]?.impact !== 'major',
    )
  )
    throw new AiError('invalid_output');
  return result;
}
