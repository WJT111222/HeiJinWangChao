import { captureAssistantSelection, resolveStoryPreset, type AssistantSelection, type PresetSelection } from '../presets/library';
import { nativeDeliveryId } from '../presets/settings';
import { deliveryContext, checkDeliveryBoundaries } from '../presets/nativeDelivery';
import { assemblePreset } from '../presets/messages';
import { storyMaterials } from '../presets/storyMaterials';
import { narrativeRange } from '../ui/settings/model';
import { openingTimeSelection } from '../domain/openingTime';
import { selectPromptModules } from './selection';
import { projectPromptOrder } from './order';
import type { PromptModule } from './manifest';
import { readPromptResource } from './loader';
import { checkedInput, contextFor, contextMessage, worldWeekday } from './context';
import type { ComposeInput } from './context';
import type { AiMessage } from '../services/ai/protocols';
import { estimateTokens } from './statistics';
import { formatTailMessage } from './formatTail';
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
/**
 * 模型服务的提示缓存按「与上一回合一字不差的开头」计费：从第一个变化的字符起后面全部重新计算。
 * 因此每回合都不变的上下文字段排在 GAME_CONTEXT 最前面，CURRENT_TIME 是第一个会变的字段。
 * Claude 格式据此在 CURRENT_TIME 之前打缓存标记（见 protocols.ts）。只调整字段顺序，不增删内容。
 */
export const STABLE_CONTEXT_KEYS = ['COMMAND_CATALOG', 'TEXT_COMMAND_CATALOG', 'PROTAGONIST_TALENT', 'NPC_KNOWLEDGE_POLICY', 'TURN_TIME_POLICY', 'PROMPT_SETTINGS'] as const;
export const FIRST_DYNAMIC_CONTEXT_KEY = 'CURRENT_TIME';
function cacheFriendlyContext(context: Record<string, unknown>, extra: { PROMPT_SETTINGS: unknown; CURRENT_TIME: unknown }) {
  const all: Record<string, unknown> = { ...context, PROMPT_SETTINGS: extra.PROMPT_SETTINGS };
  const ordered: Record<string, unknown> = {};
  for (const key of STABLE_CONTEXT_KEYS) if (key in all) ordered[key] = all[key];
  ordered[FIRST_DYNAMIC_CONTEXT_KEY] = extra.CURRENT_TIME;
  for (const [key, value] of Object.entries(all)) if (!(key in ordered)) ordered[key] = value;
  return ordered;
}
function outgoingPromptSettings<T extends { difficulty?: unknown }>(prompts: T): Omit<T, 'difficulty'> {
  const { difficulty: _difficulty, ...rest } = prompts;
  void _difficulty;
  return rest;
}
export async function composePrompt(
  unchecked: ComposeInput,
  selection: AssistantSelection = unchecked.stage === 'story' ? captureAssistantSelection() : null,
) {
  return compose(unchecked, selection === nativeDeliveryId ? null : selection, selection === nativeDeliveryId);
}
/** 正式Variables及离线预览共用同一组装器；组装本身不请求模型或写库。 */
export async function composeTextVariablesPrompt(input: ComposeInput & { stage: 'variables' }) {
  if (input.stage !== 'variables') throw new AiError('configuration');
  return compose(input);
}
async function compose(unchecked: ComposeInput, selection: PresetSelection = null, nativeDelivery = false) {
  const input = checkedInput(unchecked);
  const selected = selectPromptModules(input);
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
      ? input.stage === 'variables' || input.stage === 'world' ? openingTimeSelection(input.state, input.draft!, input.stage === 'variables' ? [] : undefined)?.endAt : undefined
      : input.state.worldClock;
  const replacements: Record<string, string | number | undefined> = {
    playerName: input.state.protagonist.name,
    worldClock: clock ?? '开局时间待确认（由本次正文按玩家设定或剧情确定）',
    worldWeekday: clock ? worldWeekday(clock) : '待开局日期确定后由程序计算',
    minNarrativeChars: input.settings.prompts.minNarrativeChars,
    maxNarrativeChars: narrativeRange(input.settings.prompts).max,
    immediateMemoryTurns: input.settings.memory.immediateWindowSize,
    npcId: input.npcId,
    npcSummaryThreshold: input.npcSummaryThreshold,
  };
  const preset = input.stage === 'story' && selection ? await resolveStoryPreset(selection) : undefined;
  const worldview: string[] = [];
  const records: ModuleRecord[] = [];
  const messages: AiMessage[] = [];
  let confirmation: AiMessage | undefined;
  for (const module of selected) {
    // Keep domain boundaries and the player's output contract while the preset owns literary preferences.
    if (preset && module.category === 'writing' &&
      !['writing.action_options', 'writing.min_length', 'writing.intimacy_boundaries'].includes(module.id)) continue;
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
    if (preset && module.category === 'worldbook') worldview.push(content);
    else if (role === 'assistant') confirmation = { role, content };
    else messages.push({ role, content });
  }
  // 剧情风格只作用于正文：非 Story 阶段出站的 PROMPT_SETTINGS 一律投影为原有的 style:'general'，
  // 字段与顺序不变；不修改玩家保存的设置，也不影响其他写作偏好。
  // 剧情难度只经 difficulty_* 模块进入请求，出站 PROMPT_SETTINGS 不携带该字段：宽松与引入难度前逐字相同。
  const promptSettings = outgoingPromptSettings(input.stage === 'story' ? input.settings.prompts : { ...input.settings.prompts, style: 'general' as const });
  const assembled = preset ? assemblePreset(preset, storyMaterials(input, context, worldview.join('\n\n'))) : undefined;
  if (assembled) messages.push(...assembled.messages);
  else {
    const ordered = input.stage === 'memory'
      ? { ...context, PROMPT_SETTINGS: promptSettings }
      : cacheFriendlyContext(context, {
        PROMPT_SETTINGS: promptSettings,
        CURRENT_TIME: { worldClock: replacements.worldClock, worldWeekday: replacements.worldWeekday },
      });
    if (nativeDelivery && input.stage === 'story') messages.push(...deliveryContext(ordered, input.draft));
    else messages.push({ role: 'user', content: contextMessage(ordered) });
  }
  // 最终格式提醒紧贴生成点：有确认历史时并入收尾 user 消息；否则作为末尾独立 user 消息。
  const tail = formatTailMessage(input.stage, {
    actionOptions: input.settings.prompts.actionOptions,
    minNarrativeChars: input.settings.prompts.minNarrativeChars,
    maxNarrativeChars: narrativeRange(input.settings.prompts).max,
    openingTime: input.mode === 'opening' && input.state.openingTimePending
      ? (input.settings.runtime.useVariableStage || input.settings.runtime.useWorldStage ? 'reference' : 'required')
      : undefined,
  });
  if (confirmation) {
    const closing = tail ? `${tail}
请按已确认的本阶段协议生成当前回合。` : '请按已确认的本阶段协议生成当前回合。';
    messages.push(confirmation, { role: 'user', content: closing });
  } else if (tail) {
    messages.push({ role: 'user', content: tail });
  }
  if (nativeDelivery && input.stage === 'story') checkDeliveryBoundaries(messages);
  if (!preset && messages.some((m) => /\{\{[^{}]*\}\}/.test(m.content))) throw new AiError('placeholder');
  return {
    messages,
    modules: records,
    ...(preset && assembled ? { preset: {
      id: preset.definition.id, version: preset.definition.version,
      sampling: preset.sampling, unknownMacros: assembled.unknownMacros,
    } } : {}),
    ...(assembled ? { presetHistory: assembled.history } : {}),
    context,
    baseSaveRevision: input.state.revision,
    storyRevision: input.draft?.storyRevision,
    audience: 'internal' as const,
  };
}
