import { usesSpreset } from '../presets/spreset/definition';
import { captureAssistantSelection } from '../presets/library';
import { promptReady, tavernGeneration, type GenerationType } from '../presets/tavern/events';
import { prepareStoryWorldbook, storyTriggerInput } from '../services/worldbook/storyWorldbook';
import { insertPlayerWorldbook } from './playerWorldbook';
import { loadMainWorldview } from '../services/worldbook/mainWorldview';
import { composePrompt } from './composer';
import type { ComposeInput } from './context';
import { contextStatistics } from './statistics';
import { windowRisk } from './budgetInspection';
import type { AiConfig, AiStage } from '../services/ai/configuration';
import { cotSupported, resolveModelRoute } from '../services/ai/snapshot';
import { safeAiError } from '../services/ai/errors';

export const inspectionStages: AiStage[] = ['story', 'entities', 'variables', 'world'];
export function previewRoute(config: AiConfig, stage: AiStage) {
  try {
    const { channel, model } = resolveModelRoute(config, stage);
    return {
      configured: true,
      channelName: channel.name,
      channelId: channel.id,
      protocol: channel.protocol,
      model,
      cotAllowed: cotSupported(channel, model, stage),
      window: windowRisk(0),
    };
  } catch {
    return {
      configured: false,
      channelName: '未配置可用路由',
      channelId: '',
      protocol: '',
      model: '未知',
      cotAllowed: false,
      window: windowRisk(0),
    };
  }
}
export type StagePreview =
  | {
      ok: true;
      prompt: Awaited<ReturnType<typeof composePrompt>>;
      route: ReturnType<typeof previewRoute>;
      statistics: ReturnType<typeof contextStatistics>;
      contentRedacted?: boolean;
    }
  | { ok: false; reason: string };
export function previewRequirement(
  input: Pick<ComposeInput, 'stage' | 'mode' | 'state' | 'draft'>,
) {
  if (!input.state) return '没有已选存档，无法组装游戏上下文。';
  if (input.stage === 'story') return undefined;
  if (!input.draft?.story || input.draft.stageStatus.story !== 'ready')
    return '缺少已选定的正文草稿；M4 尚未接入，不会伪造阶段请求。';
  if (input.draft.turnKind !== input.mode)
    return '现有草稿的回合模式不匹配，不能伪造另一种模式的阶段数据。';
  if (
    (input.stage === 'entities' && !input.draft.useEntityStage) ||
    (input.stage === 'variables' && !input.draft.useVariableStage) ||
    (input.stage === 'world' && !input.draft.useWorldStage)
  )
    return '该阶段在草稿执行尝试中已关闭，需要显式补算后才能组装。';
  return undefined;
}
export async function previewStoryMessages(input: ComposeInput, prompt: Awaited<ReturnType<typeof composePrompt>>, type: GenerationType, scripted: boolean) {
  const { foundation, presetHistory, messages } = prompt;
  const base = messages.filter(message => message !== foundation);
  const worldbook = await prepareStoryWorldbook(storyTriggerInput(input, type));
  const ready = scripted ? await tavernGeneration(type, undefined, true, 0, () => promptReady(base, true)) : base;
  return [...insertPlayerWorldbook(ready, { foundation, history: presetHistory, plan: worldbook.status === 'ok' ? worldbook.plan : undefined })];
}

export async function buildStagePreviews(input: Omit<ComposeInput, 'stage'>, config: AiConfig,
  readOriginal?: () => Promise<NonNullable<ComposeInput['worldview']>>) {
  let original: ReturnType<typeof loadMainWorldview> | undefined;
  const entries = await Promise.all(
    inspectionStages.map(async (stage): Promise<[AiStage, StagePreview]> => {
      const selected = { ...input, stage };
      const missing = previewRequirement(selected);
      if (missing) return [stage, { ok: false, reason: missing }];
      const route = previewRoute(config, stage);
      try {
        const draft = stage === 'story' && input.draft?.turnKind !== input.mode ? undefined : input.draft;
        const captured = { ...selected, draft, worldview: selected.worldview ??
          (stage !== 'story' && readOriginal ? await (original ??= readOriginal()) : await loadMainWorldview()), cotAllowed: route.cotAllowed };
        const preset = stage === 'story' ? captureAssistantSelection() : null;
        const prompt = await composePrompt(captured, preset);
        if (stage === 'story') {
          const type = draft?.story || draft?.storyPartial || draft?.failures.some(f => f.stage === 'story') ? 'regenerate' : 'normal';
          prompt.messages = await previewStoryMessages(captured, prompt, type, !!preset && !usesSpreset(preset));
        }
        return [stage, { ok: true, prompt, route, statistics: contextStatistics(prompt.messages) }];
      } catch (error) {
        return [stage, { ok: false, reason: safeAiError(error).message }];
      }
    }),
  );
  return Object.fromEntries(entries) as Record<AiStage, StagePreview>;
}
