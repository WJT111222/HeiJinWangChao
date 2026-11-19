import type { PresetSelection } from '../../presets/library';
import { worldNormalizationNotes } from '../validation/worldSceneWrites';
import { narrativeRange } from '../../ui/settings/model';
import { validateStoryEventInteractions } from '../../domain/events/interactions';
import { AiError } from './errors';
import { browserPromptOrder } from '../../prompts/order';
import { composePrompt, composeTextVariablesPrompt } from '../../prompts/composer';
import { checkedInput } from '../../prompts/context';
import type { ComposeInput } from '../../prompts/context';
import { parseStoryEnvelope, parseTextVariables, parseVariables, parseWorld } from '../validation/aiOutputs';
import type { AiConfig, AiStage } from './configuration';
import type { CredentialVault } from './credentials';
import { requestSnapshot } from './snapshot';
import { AiClient } from './client';
import type { RequestOptions } from './client';
import { variableFailure, variableValidationError } from '../validation/variableDiagnostics';
import { storyFailure } from '../validation/storyDiagnostics';
import { timeOutcome } from '../../domain/timePreflight';
import { stageResponses, safeStreamResponseText, responseLimitsFor } from './stageResponses';
import { safeAiError } from './errors';
import { mergeResponseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';
import { continuationInstruction, mergeContinuation, trimIncompleteTag } from '../../domain/storyContinuation';
import type { StoryFailureText } from '../../domain/storyContinuation';
import { splitLeadingThink } from './compat';

/** 正文续写：已写出的截断原文（已隐藏凭证）。只用于正文阶段。 */
export interface StageRequestOptions extends RequestOptions { presetSelection?: PresetSelection; continuation?: { partial: string } }
/**
 * 正文请求失败时收到的内容（去掉前导 <think> 推理；续写时为与已写部分拼接后的全文），供上层保存为可续写的截断正文。
 * 以失败对象为键，不进入错误消息或诊断展示。
 */
export const storyFailureText = new WeakMap<object, StoryFailureText>();

// 独立阶段请求入口；没有 SaveRepository、写库、重试或自动执行下游阶段。
export async function runStageRequest(
  input: ComposeInput & { stage: AiStage },
  config: AiConfig,
  vault: CredentialVault,
  options: StageRequestOptions = {},
  client = new AiClient(),
) {
  try { return await runStageRequestUnchecked(input, config, vault, options, client); }
  catch (error) { throw input.stage === 'variables' ? variableFailure(error, 'context') : error; }
}
async function runStageRequestUnchecked(input: ComposeInput & { stage: AiStage }, config: AiConfig,
  vault: CredentialVault, stageOptions: StageRequestOptions, client: AiClient) {
  const { continuation: requestedContinuation, presetSelection, ...options } = stageOptions;
  if (requestedContinuation && input.stage !== 'story') throw new AiError('configuration');
  if (input.orderOverrides && input.orderPreferences) throw new AiError('configuration');
  const captured = checkedInput({
    ...input,
    orderPreferences: input.orderOverrides
      ? undefined
      : (input.orderPreferences ?? browserPromptOrder()),
  }) as ComposeInput & { stage: AiStage };
  if (captured.stage === 'world' && captured.draft?.variables?.validation === 'validated')
    parseVariables(JSON.stringify(captured.draft.variables.result), captured.state, captured.draft);
  const generation = stageResponses.generation();
  const snapshot = requestSnapshot(config, captured.stage, vault);
  const prompt = captured.stage === 'variables'
    ? await composeTextVariablesPrompt({ ...captured, stage: 'variables', cotAllowed: snapshot.useCot })
    : await composePrompt({ ...captured, cotAllowed: snapshot.useCot }, presetSelection);
  // 续写：上下文与原请求完全相同（缓存前缀不变），末尾追加已写部分（assistant）与续写指令（user）。
  const continuation = requestedContinuation ? { partial: trimIncompleteTag(requestedContinuation.partial) } : undefined;
  const messages = continuation
    ? [...prompt.messages, { role: 'assistant' as const, content: continuation.partial },
      { role: 'user' as const, content: continuationInstruction({ actionOptions: captured.settings.prompts.actionOptions,
        minNarrativeChars: captured.settings.prompts.minNarrativeChars, maxNarrativeChars: narrativeRange(captured.settings.prompts).max,
        partial: continuation.partial }) }]
    : prompt.messages;
  const merged = (text: string) => continuation ? mergeContinuation(continuation.partial, text) : text;
  const responseId = stageResponses.begin({ saveId: captured.state.saveId, turnId: captured.draft?.turnId, stage: captured.stage, storyRevision: captured.draft?.storyRevision, protocol: snapshot.channel.protocol, baseSaveRevision: captured.state.revision,
    draftRevision: captured.draft?.draftRevision, executionRevision: captured.draft?.executionRevision,
    stageRequestRevision: captured.stage === 'story' ? undefined : captured.draft?.stageRequestRevisions[captured.stage],
    basedOnVariableRevision: captured.stage === 'world' ? captured.draft?.variables?.candidateRevision : undefined }, generation);
  const secrets = config.channels.map(channel => vault.get(channel.id)).filter(Boolean);
  const responseLimits = responseLimitsFor(captured.stage);
  let received = '', sealed = false, truncated = false;
  let diagnostics: ResponseDiagnostics = {};
  const append = (text: string, delta: string, limit: number) => {
    if (text.length + delta.length > limit) truncated = true;
    return text + delta.slice(0, Math.max(0, limit - text.length));
  };
  let rawObserved = false, publicReasoning = '';
  let displayText = '', displayObserved = false, displayOrder: RawResponseObservation['order'] = 'events';
  const preview = (value: string) => captured.stage === 'story' ? safeStreamResponseText(value, secrets) : value;
  const display = () => !displayObserved ? {} : {
    displayText: safeStreamResponseText(displayText, secrets), displayOrder,
  };
  let observationTimer: ReturnType<typeof setTimeout> | undefined;
  const observe = () => {
    if (!observationTimer) observationTimer = setTimeout(() => {
      observationTimer = undefined;
      stageResponses.update(responseId, { text: preview(received),
        nativeReasoning: preview(publicReasoning), diagnostics, truncated, ...display() }, secrets);
    }, 50);
  };
  let step: 'request' | 'response' = 'request';
  // 本次请求模型返回的原始文字（续写时不含已写部分）；诊断展示用的 received 在续写成功接收后会换成拼接全文。
  let addition: string | undefined;
  try {
  const response = await client.generate(snapshot, messages, {
    ...options,
    presetSampling: prompt.preset?.sampling,
    // Only Story may evaluate a complete limit response; other stages remain strict.
    validateStoryOutputLimit: captured.stage === 'story',
    onResponseDiagnostics: (value) => {
      if (sealed || options.signal?.aborted) return;
      diagnostics = mergeResponseDiagnostics(diagnostics, value); observe();
      options.onResponseDiagnostics?.(value);
    },
    onRawResponse: (event: RawResponseObservation) => {
      if (sealed || options.signal?.aborted) return;
      if (event.text && captured.stage === 'story') {
        displayObserved = true; displayText = append(displayText, event.text, responseLimits.displayText);
        if (event.order === 'unknown' || displayOrder === 'events') displayOrder = event.order;
        observe();
      }
      options.onRawResponse?.(event);
    },
    onDelta: (delta) => { if (sealed || options.signal?.aborted) return; if (!rawObserved) received = append(received, delta, responseLimits.text); options.onDelta?.(delta); },
    onRawTextDelta: (delta) => {
      if (sealed || options.signal?.aborted) return;
      rawObserved = true; received = append(received, delta, responseLimits.text);
      observe();
      options.onRawTextDelta?.(delta);
    },
    onNativeReasoningDelta: (delta) => {
      if (sealed || options.signal?.aborted) return;
      publicReasoning = append(publicReasoning, delta, responseLimits.nativeReasoning);
      observe();
      options.onNativeReasoningDelta?.(delta);
    },
    inspection: {
      kind: 'stage',
      responseId,
      mode: captured.mode,
      saveId: captured.state.saveId,
      revision: captured.state.revision,
      storyRevision: captured.draft?.storyRevision,
      modules: prompt.modules,
    },
    timeoutSeconds: options.timeoutSeconds ?? captured.settings.runtime.timeoutSeconds,
    stream: options.stream ?? captured.stage === 'story',
  });
  sealed = true;
  clearTimeout(observationTimer);
  step = 'response';
  if (!rawObserved) received = append('', response.text, responseLimits.text);
  addition = received;
  // 续写时诊断原文与解析输入都是拼接后的全文；非续写时与原来完全一致。
  if (continuation) received = append('', merged(received), responseLimits.text);
  stageResponses.update(responseId, { text: received, nativeReasoning: publicReasoning, diagnostics, truncated, ...display(), status: 'received' }, secrets);
  const responseText = merged(response.text);
  const envelope = (() => {
    if (captured.stage !== 'story') return undefined;
    try { return parseStoryEnvelope(responseText, captured.mode, captured.settings); }
    catch (error) {
      // Genuine missing tail/body retains the established partial/continuation path.
      // Complete but invalid content keeps its precise strict validation error.
      if (response.outputLimited && error instanceof AiError && ['tag_missing', 'tag_unclosed'].includes(String(error.details?.storyRule)))
        throw new AiError('output_limit');
      throw error;
    }
  })();
  const story = envelope?.story;
  if (story) {
    try { validateStoryEventInteractions(captured.state, story,captured.legacyNotificationRecovery); }
    catch (error) {
      throw storyFailure(error);
    }
    try { timeOutcome(captured.state, { userInput: captured.userInput, turnKind: captured.mode, story }, true); }
    catch (error) { const failure = storyFailure(error); throw failure instanceof AiError ? failure : variableValidationError(error); }
  }
  const result = story ?? (captured.stage === 'variables'
        ? await parseTextVariables(responseText, captured.state, captured.draft!)
        : parseWorld(responseText, captured.state, captured.draft!));
  const notes = story ? undefined : worldNormalizationNotes.get(result);
  stageResponses.update(responseId, { status: 'validated', normalized: JSON.stringify(result, null, 2), ...(notes ? { notes } : {}) }, secrets);
  return {
    result,
    responseInspectionId: responseId,
    // 临时诊断单独返回；StorySchema和后续阶段永远不接收这些字段。
    storyInspection: envelope ? { planning: envelope.planning, nativeReasoning: response.nativeReasoning } : undefined,
    usage: response.usage,
    diagnostics: response.diagnostics,
    modules: prompt.modules,
    ...(prompt.preset ? { preset: prompt.preset } : {}),
    baseSaveRevision: prompt.baseSaveRevision,
    storyRevision: prompt.storyRevision,
    requestBasis: {
      saveId: captured.state.saveId,
      turnId: captured.draft?.turnId,
      baseSaveRevision: captured.state.revision,
      draftRevision: captured.draft?.draftRevision,
      storyRevision: captured.draft?.storyRevision,
      executionRevision: captured.draft?.executionRevision,
      stageRequestRevision:
        captured.stage === 'story'
          ? undefined
          : captured.draft?.stageRequestRevisions[captured.stage],
      basedOnVariableRevision:
        captured.stage === 'world' ? captured.draft?.variables?.candidateRevision : undefined,
    },
    variablePending: captured.stage === 'world' ? prompt.context.variablePending : undefined,
    commitAllowed: false as const,
    audience: 'internal' as const,
  };
  } catch (error) {
    const failure = captured.stage === 'variables' ? variableFailure(error, step) : captured.stage === 'story' ? storyFailure(error, true) : error;
    sealed = true;
    if (captured.stage === 'story' && failure && typeof failure === 'object') {
      // 兼容渠道会把推理写成开头的 <think>…</think>：与正式解析一致先去掉，推理不进入可续写的正文。
      const raw = addition ?? received, content = splitLeadingThink(raw).content;
      storyFailureText.set(failure, { produced: raw.trim() !== '',
        text: !continuation ? content : content.trim() ? merged(content) : continuation.partial });
    }
    clearTimeout(observationTimer);
    stageResponses.update(responseId, { status: 'failed', text: preview(received),
      nativeReasoning: preview(publicReasoning), diagnostics, truncated, ...display(), error: safeAiError(failure) }, secrets);
    throw failure;
  }
}
