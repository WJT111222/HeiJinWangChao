import { logicalMessageCount } from '../../domain/worldbook/timedEffects';
import { prepareStoryWorldbook } from '../worldbook/storyWorldbook';
import type { PlayerWorldbook } from '../../prompts/playerWorldbook';
import { nativeReferenceRecords } from '../../presets/nativeDelivery';
import { captureAssistantPreferences, ensureNativeDeliveryHost, withTavernRequest } from '../../presets/tavern/hostState';
import { promptReady, tavernGeneration, type GenerationType } from '../../presets/tavern/events';
import { nativeDeliveryId } from '../../presets/settings';
import type { AssistantSelection } from '../../presets/library';
import { parsePartialVariables, parsePartialWorld } from '../validation/partialOutputs';
import { worldNormalizationNotes } from '../validation/worldSceneWrites';
import { narrativeRange } from '../../ui/settings/model';
import { DataError } from '../../domain/common';
import { historicalPerspective } from '../../domain/timePreflight';
import { validateStoryEventInteractions } from '../../domain/events/interactions';
import { AiError } from './errors';
import { browserPromptOrder } from '../../prompts/order';
import { composePrompt, composeTextVariablesPrompt } from '../../prompts/composer';
import { checkedInput } from '../../prompts/context';
import type { ComposeInput } from '../../prompts/context';
import { parseStoryEnvelope, parseVariables } from '../validation/aiOutputs';
import type { AiConfig, AiStage } from './configuration';
import type { CredentialVault } from './credentials';
import { requestSnapshot, secretFor, type RequestSnapshot } from './snapshot';
import { AiClient } from './client';
import type { RequestOptions } from './client';
import { variableFailure } from '../validation/variableDiagnostics';
import { storyFailure } from '../validation/storyDiagnostics';
import { attachFailureDiagnostic, attachObservedRequest, carryFailureDiagnostic, failurePhase, reasoningTagPresence, scanStoryTags } from './failureDiagnostic';
import type { FailureDiagnostic } from './failureDiagnostic';
import { stageResponses, safeStreamResponseText, responseLimitsFor } from './stageResponses';
import { safeAiError } from './errors';
import { mergeResponseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';
import { continuationInstruction, mergeContinuation, trimIncompleteTag } from '../../domain/storyContinuation';
import type { StoryFailureText } from '../../domain/storyContinuation';
import { splitLeadingThink } from './compat';

/** 正文续写：已写出的截断原文（已隐藏凭证）。只用于正文阶段。 */
export interface StageRequestOptions extends Omit<RequestOptions, 'tavernType' | 'playerWorldbook'> { frozenStoryChannel?: RequestSnapshot; presetSelection?: AssistantSelection; continuation?: { partial: string } }
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
  const { continuation: requestedContinuation, frozenStoryChannel, presetSelection: suppliedSelection, ...options } = stageOptions;
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
  if (frozenStoryChannel && (captured.stage !== 'story' || frozenStoryChannel.stage !== 'story')) throw new AiError('configuration');
  const snapshot = frozenStoryChannel ?? requestSnapshot(config, captured.stage, vault);
  const nativeAllowed = captured.stage === 'story' && !requestedContinuation && !captured.legacyNotificationRecovery;
  const selected = captured.stage === 'story' && suppliedSelection === undefined
    ? captureAssistantPreferences(nativeAllowed) : suppliedSelection;
  const presetSelection = selected === nativeDeliveryId && !nativeAllowed ? null : selected;
  const type = requestedContinuation ? 'continue' : captured.draft?.story || captured.draft?.storyPartial
    || captured.draft?.failures.some(f => f.stage === 'story') ? 'regenerate' : 'normal';
  const generation = stageResponses.generation();
  const run = () => executePrepared(captured, snapshot, presetSelection, type, config, vault, options, requestedContinuation, client, generation);
  if (!presetSelection || captured.stage !== 'story') return run();
  if (presetSelection === nativeDeliveryId) await ensureNativeDeliveryHost(options.signal);
  const recent = captured.state.journal.slice(-captured.settings.memory.immediateWindowSize);
  const chatLength = 1 + recent.reduce((sum, entry) => sum + 1 + Number(Boolean(captured.historyActions?.[entry.turnId])), 0);
  return withTavernRequest({ ...captured, stage: 'story' }, snapshot.channel.protocol, type, presetSelection === nativeDeliveryId ? undefined : presetSelection.overrides,
    () => tavernGeneration(type, options.signal, false, chatLength, () => {
      options.storyClock?.first('generationEventsDoneMs');
      return run();
    }));
}

async function executePrepared(captured: ComposeInput & { stage: AiStage }, snapshot: RequestSnapshot,
  presetSelection: AssistantSelection | undefined, type: GenerationType, config: AiConfig, vault: CredentialVault,
  options: RequestOptions, requestedContinuation: StageRequestOptions['continuation'], client: AiClient, generation: number) {
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
  if (presetSelection && captured.stage === 'story') secrets.push(secretFor(snapshot));
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
  // 本次模型增量（续写不含已写部分）。addition 在拼接前定格，诊断用它区分提取前原文。
  let addition: string | undefined;
  let modelText: string | undefined;
  let formalText: string | undefined;
  let responseReasoning: string | undefined;
  let response: Awaited<ReturnType<AiClient['generate']>> | undefined;
  try {
  let playerWorldbook: PlayerWorldbook | undefined;
  const storyNotes: string[] = [];
  if (captured.stage === 'story') {
    if (options.signal?.aborted) throw new AiError('cancelled');
    const { state, draft, settings } = captured;
    const failedAttempts = draft?.failures.filter(failure => failure.stage === 'story') ?? [];
    const retry = draft?.stageStatus.story === 'failed' || failedAttempts.some(f => f.storyRevision === draft?.storyRevision);
    try {
      const worldbook = await prepareStoryWorldbook({
        messages: [draft?.userInput ?? captured.userInput,
          ...state.journal.slice(-Math.min(settings.memory.immediateWindowSize, 10)).reverse().map(entry => entry.story.narrative)],
        // Routes currently have no verified model context window or input allowance.
        contextTokens: 32_000,
        storyRemainingTokens: 4_096,
        trigger: type === 'continue' ? type : retry ? 'normal' : type,
        messageCount: logicalMessageCount(state.turnNumber),
        seed: `${state.saveId}:${draft?.turnId ?? state.turnNumber}:${(draft?.storyRevision ?? 0) + failedAttempts.length + 1}`,
      }, { signal: options.signal });
      if (worldbook.status === 'ok') {
        playerWorldbook = { plan: worldbook.plan, history: prompt.presetHistory };
        if (worldbook.incomplete) storyNotes.push('世界书达到扫描工作量上限，本次使用已找到的资料。');
      } else if (worldbook.status === 'skipped') storyNotes.push(worldbook.message);
    } catch {
      storyNotes.push('世界书准备失败，本次未使用玩家世界书。');
    }
    if (storyNotes.length) stageResponses.update(responseId, { notes: storyNotes }, secrets);
    if (options.signal?.aborted) throw new AiError('cancelled');
  }
  const scripted = captured.stage === 'story' && !!presetSelection;
  if (presetSelection === nativeDeliveryId && !captured.draft)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.native_delivery.action' });
  const nativeDeliveryReference = presetSelection === nativeDeliveryId ? nativeReferenceRecords(messages) : undefined;
  const responseResult = await client.generate(snapshot, scripted ? await promptReady(messages, false) : messages, {
    ...options,
    tavernType: scripted ? type : undefined,
    playerWorldbook,
    presetSampling: prompt.preset?.sampling,
    nativeDeliveryReference,
    // Only Story may evaluate a complete limit response; other stages remain strict.
    validateStoryOutputLimit: captured.stage === 'story',
    onResponseDiagnostics: (value) => {
      if (sealed || (options.signal?.aborted && !value.tavern)) return;
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
  response = responseResult;
  modelText = response.text;
  responseReasoning = response.nativeReasoning;
  if (captured.stage === 'story') formalText = merged(response.text);
  sealed = true;
  clearTimeout(observationTimer);
  step = 'response';
  if (!rawObserved) received = append('', response.text, responseLimits.text);
  addition = received;
  // 临时原文视图在续写时改成拼接全文。诊断仍分开记提取前原文、提取后正文和解析输入。
  if (continuation) received = append('', merged(received), responseLimits.text);
  stageResponses.update(responseId, { text: received, nativeReasoning: publicReasoning, diagnostics, truncated, ...display(), status: 'received' }, secrets);
  const responseText = merged(response.text);
  const envelope = (() => {
    if (captured.stage !== 'story') return undefined;
    try { return parseStoryEnvelope(responseText, captured.mode, captured.settings); }
    catch (error) {
      // Genuine missing tail/body retains the established partial/continuation path.
      // Complete but invalid content keeps its precise strict validation error.
      if (response.outputLimited && error instanceof AiError && ['tag_missing', 'tag_unclosed'].includes(String(error.details?.storyRule))) {
        const limited = new AiError('output_limit');
        carryFailureDiagnostic(error, limited);
        throw limited;
      }
      throw error;
    }
  })();
  const story = envelope?.story;
  if (story && envelope) {
    const basis = { turnKind: captured.mode, userInput: captured.userInput, story };
    try { historicalPerspective(captured.state, basis); }
    catch (error) {
      if (!(error instanceof DataError)) throw error;
      story.variableGuide = story.variableGuide.filter(g => g.subjectHint !== 'time:retrospective' && !g.eventInteraction && !g.eventNarration);
      envelope.notes.push('未确认的历史视角声明已保留在参考笔记中。');
    }
    try { validateStoryEventInteractions(captured.state, story, captured.legacyNotificationRecovery); }
    catch (error) {
      if (!(error instanceof DataError) || captured.legacyNotificationRecovery) throw storyFailure(error);
      // A bad batch of receipts authorizes no event write. Keep its original
      // evidence for Variables and leave existing entries untouched.
      story.variableGuide = story.variableGuide.filter(g => !g.eventInteraction && !g.eventNarration);
      envelope.notes.push('本幕事件回执未通过核验，未授予事件操作。');
    }
  }
  const result = story ?? (captured.stage === 'variables'
        ? await parsePartialVariables(responseText, captured.state, captured.draft!)
        : await parsePartialWorld(responseText, captured.state, captured.draft!));
  const notes = envelope ? [...storyNotes, ...envelope.notes] : worldNormalizationNotes.get(result);
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
    // 兼容包装和协议错误已有具体位置；仅将实际正文错误归入 Story 格式诊断。
    const compatibilityError = prompt.preset && error instanceof AiError && error.details?.fieldPath?.startsWith('tavern.');
    const failure = captured.stage === 'variables' ? variableFailure(error, step)
      : captured.stage === 'story' && !compatibilityError ? storyFailure(error, true) : error;
    sealed = true;
    if (captured.stage === 'story' && failure && typeof failure === 'object') {
      // 兼容渠道会把推理写成开头的 <think>…</think>：与正式解析一致先去掉，推理不进入可续写的正文。
      const raw = addition ?? received, content = splitLeadingThink(raw).content;
      storyFailureText.set(failure, { produced: raw.trim() !== '',
        text: !continuation ? content : content.trim() ? merged(content) : continuation.partial });
    }
    clearTimeout(observationTimer);
    const path = error instanceof AiError ? error.details?.fieldPath : undefined;
    let storyLayer: 'request' | 'story_validation' | 'upstream' | 'wrapper' = 'request';
    const deadline = diagnostics.tavern?.timeline?.deadlinePhase;
    if (step === 'response') storyLayer = 'story_validation';
    else if (deadline === 'wrapper_restore') storyLayer = 'wrapper';
    else if (deadline === 'upstream_read' || deadline === 'awaiting_headers' || deadline === 'awaiting_bytes') storyLayer = 'upstream';
    else if (deadline) storyLayer = 'request';
    else if (diagnostics.tavern?.upstreamError || path?.startsWith('tavern.upstream.')) storyLayer = 'upstream';
    else if (diagnostics.tavern && diagnostics.tavern.wrapper !== 'pending') storyLayer = 'wrapper';
    const preset = captured.stage !== 'story' || !presetSelection ? 'off' as const
      : presetSelection === nativeDeliveryId ? 'native' as const : 'script' as const;
    const field = failure instanceof AiError ? failure.details?.fieldPath : path;
    if (response && failure !== response) carryFailureDiagnostic(response, failure);
    const actions = captured.settings.prompts.actionOptions;
    // 提取前原文只来自 onRawTextDelta。response.text 已去掉前导思考，不能当成原文。
    const observedRaw = rawObserved && !truncated ? (addition ?? received) : undefined;
    const extracted = modelText;
    const parsedInput = formalText;
    const reasoningText = responseReasoning ?? (truncated ? undefined : publicReasoning);
    attachObservedRequest(failure, {
      preset,
      phase: failurePhase(field, deadline) ?? (step === 'response' && captured.stage === 'story' && !String(field ?? '').startsWith('tavern.') ? 'story_validation' : undefined),
      ...(typeof diagnostics.errorPresent === 'boolean' ? { errorInBody: diagnostics.errorPresent } : {}),
      ...(observedRaw !== undefined ? { contentChars: observedRaw.length } : {}),
      ...(reasoningText !== undefined ? { reasoningChars: reasoningText.length } : {}),
    });
    if (captured.stage === 'story') {
      const patch: Partial<FailureDiagnostic> = {};
      if (observedRaw !== undefined) patch.storyTags = scanStoryTags(observedRaw, actions);
      if (extracted !== undefined && extracted !== observedRaw) {
        patch.extractedChars = extracted.length;
        patch.extractedTags = scanStoryTags(extracted, actions);
      }
      if (parsedInput !== undefined && parsedInput !== observedRaw && parsedInput !== extracted) {
        patch.parseInputChars = parsedInput.length;
        patch.parseTags = scanStoryTags(parsedInput, actions);
      }
      if (Object.keys(patch).length) attachFailureDiagnostic(failure, patch);
      if (reasoningText) attachFailureDiagnostic(failure, { reasoningTags: reasoningTagPresence(reasoningText) });
    }
    stageResponses.update(responseId, { status: 'failed',
      ...(captured.stage === 'story' ? { failureLayer: storyLayer } : {}),
      ...(storyLayer === 'story_validation' && options.storyClock ? { validationEndMs: options.storyClock.elapsed() } : {}),
      text: preview(received),
      nativeReasoning: preview(publicReasoning), diagnostics, truncated, ...display(), error: safeAiError(failure) }, secrets);
    throw failure;
  }
}

/** Run the same preset composer and preview events without a channel, transport or repository write. */
export async function previewTavernStory(input: ComposeInput & { stage: 'story' }, type: GenerationType = 'normal') {
  const selected = captureAssistantPreferences();
  if (!selected) throw new AiError('configuration');
  const captured = checkedInput(input);
  return tavernGeneration(type, undefined, true, 0, async () =>
    promptReady((await composePrompt(captured, selected)).messages, true));
}
