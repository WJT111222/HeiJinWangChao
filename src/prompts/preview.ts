import { composePrompt } from './composer';
import type { ComposeInput } from './context';
import { contextStatistics } from './statistics';
import type { AiConfig, AiStage } from '../services/ai/configuration';
import { cotSupported, resolveModelRoute } from '../services/ai/snapshot';
import { safeAiError } from '../services/ai/errors';

export const inspectionStages: AiStage[] = ['story', 'variables', 'world'];
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
    };
  } catch {
    return {
      configured: false,
      channelName: '未配置可用路由',
      channelId: '',
      protocol: '',
      model: '未知',
      cotAllowed: false,
    };
  }
}
export type StagePreview =
  | {
      ok: true;
      prompt: Awaited<ReturnType<typeof composePrompt>>;
      route: ReturnType<typeof previewRoute>;
      statistics: ReturnType<typeof contextStatistics>;
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
    (input.stage === 'variables' && !input.draft.useVariableStage) ||
    (input.stage === 'world' && !input.draft.useWorldStage)
  )
    return '该阶段在草稿执行尝试中已关闭，需要显式补算后才能组装。';
  return undefined;
}
export async function buildStagePreviews(input: Omit<ComposeInput, 'stage'>, config: AiConfig) {
  const entries = await Promise.all(
    inspectionStages.map(async (stage): Promise<[AiStage, StagePreview]> => {
      const selected = { ...input, stage };
      const missing = previewRequirement(selected);
      if (missing) return [stage, { ok: false, reason: missing }];
      const route = previewRoute(config, stage);
      try {
        const prompt = await composePrompt({
          ...selected,
          draft:
            stage === 'story' && input.draft?.turnKind !== input.mode ? undefined : input.draft,
          cotAllowed: route.cotAllowed,
        });
        return [stage, { ok: true, prompt, route, statistics: contextStatistics(prompt.messages) }];
      } catch (error) {
        return [stage, { ok: false, reason: safeAiError(error).message }];
      }
    }),
  );
  return Object.fromEntries(entries) as Record<AiStage, StagePreview>;
}
