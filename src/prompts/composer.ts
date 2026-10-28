import { openingTimeSelection } from '../domain/openingTime';
import { selectPromptModules } from './selection';
import { projectPromptOrder } from './order';
import type { PromptModule } from './manifest';
import { readPromptResource } from './loader';
import { checkedInput, contextFor, contextMessage, worldWeekday } from './context';
import type { ComposeInput } from './context';
import type { AiMessage } from '../services/ai/protocols';
import { estimateTokens } from './statistics';
import { AiError } from '../services/ai/errors';

export interface ModuleRecord {
  id: string;
  version: string;
  contentSha256: string;
  role: AiMessage['role'];
  order: number;
  characters: number;
  estimatedTokens: number;
}
export async function composePrompt(unchecked: ComposeInput) {
  if (unchecked.stage === 'variables') return composeTextVariablesPrompt({ ...unchecked, stage: 'variables' });
  return compose(unchecked, 'json');
}
/** 正式Variables及离线预览共用同一组装器；组装本身不请求模型或写库。 */
export async function composeTextVariablesPrompt(input: ComposeInput & { stage: 'variables' }) {
  if (input.stage !== 'variables') throw new AiError('configuration');
  return compose(input, 'text');
}
async function compose(unchecked: ComposeInput, variableProtocol: 'json' | 'text') {
  const input = checkedInput(unchecked);
  const selected = selectPromptModules(input, variableProtocol);
  if (input.orderOverrides && input.orderPreferences) throw new AiError('configuration');
  const overrides =
    input.orderOverrides ?? projectPromptOrder(input.orderPreferences ?? {}, selected);
  for (const [id, order] of Object.entries(overrides)) {
    const module = selected.find((m) => m.id === id);
    if (!module?.reorderable || !Number.isInteger(order)) throw new AiError('configuration');
  }
  for (const group of new Set(selected.filter((m) => m.reorderable).map((m) => m.orderGroup))) {
    const members = selected.filter((m) => m.reorderable && m.orderGroup === group);
    const current = members.map((m) => overrides[m.id] ?? m.defaultOrder).sort((a, b) => a - b);
    const slots = members.map((m) => m.defaultOrder).sort((a, b) => a - b);
    if (current.join() !== slots.join()) throw new AiError('configuration');
  }
  const order = (m: PromptModule) => overrides[m.id] ?? m.defaultOrder;
  selected.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  if (
    new Set(selected.map((m) => m.id)).size !== selected.length ||
    new Set(selected.map((m) => m.path)).size !== selected.length
  )
    throw new AiError('configuration');
  const context = contextFor(input);
  const clock =
    typeof context.worldClock === 'string' ? context.worldClock : input.state.openingTimePending
      ? input.stage === 'variables' || input.stage === 'world' ? openingTimeSelection(input.state, input.draft!)?.endAt : undefined
      : input.state.worldClock;
  const replacements: Record<string, string | number | undefined> = {
    playerName: input.state.protagonist.name,
    worldClock: clock ?? '开局时间待确认（由本次正文按玩家设定或剧情确定）',
    worldWeekday: clock ? worldWeekday(clock) : '待开局日期确定后由程序计算',
    minNarrativeChars: input.settings.prompts.minNarrativeChars,
    immediateMemoryTurns: input.settings.memory.immediateWindowSize,
    npcId: input.npcId,
    npcSummaryThreshold: input.npcSummaryThreshold,
  };
  const records: ModuleRecord[] = [];
  const messages: AiMessage[] = [];
  let confirmation: AiMessage | undefined;
  for (const module of selected) {
    let content = await readPromptResource(module.id);
    content = content.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, key: string) => {
      const value = replacements[key];
      if (value === undefined || String(value).trim() === '') throw new AiError('placeholder');
      return JSON.stringify(String(value))
        .slice(1, -1)
        .replace(/[<>]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
    });
    const role = module.messageRole!;
    records.push({
      id: module.id,
      version: module.version,
      contentSha256: module.contentSha256,
      role,
      order: order(module),
      characters: Array.from(content).length,
      estimatedTokens: estimateTokens(content).estimatedTokens,
    });
    if (role === 'assistant') confirmation = { role, content };
    else messages.push({ role, content });
  }
  messages.push({
    role: 'user',
    content: contextMessage({ ...context, PROMPT_SETTINGS: input.settings.prompts }),
  });
  if (confirmation) messages.push(confirmation, { role: 'user', content: '请按已确认的本阶段协议生成当前回合。' });
  if (messages.some((m) => /\{\{[^{}]*\}\}/.test(m.content))) throw new AiError('placeholder');
  return {
    messages,
    modules: records,
    context,
    baseSaveRevision: input.state.revision,
    storyRevision: input.draft?.storyRevision,
    audience: 'internal' as const,
  };
}
