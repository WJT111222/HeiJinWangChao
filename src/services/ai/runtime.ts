import { usesSpreset } from '../../presets/spreset/definition';
import { parsePartialEntities } from '../validation/partialOutputs';
import { canonicalJson } from '../../domain/worldbook/canonical';
import { StoryClock } from '../../presets/tavern/timing';
import { preparationSeconds, withStoryPreparation } from './storyPreparation';
import { prepareStoryWorldbook, storyTriggerInput } from '../worldbook/storyWorldbook';
import { loadMainWorldview, missingWorldview } from '../worldbook/mainWorldview';
import type { PlayerWorldbook } from '../../prompts/playerWorldbook';
import { isPeinture } from '../../presets/peintureSettings';
import { nativeOutputTool, nativeReferenceRecords } from '../../presets/nativeDelivery';
import { captureAssistantPreferences, ensureNativeDeliveryHost, withTavernRequest } from '../../presets/tavern/hostState';
import { promptReady, tavernGeneration, type GenerationType } from '../../presets/tavern/events';
import { nativeDeliveryId } from '../../presets/settings';
import { captureStoryWriting, canResumeWriting, type AssistantSelection } from '../../presets/library';
import { parsePartialVariables, parsePartialWorld } from '../validation/partialOutputs';
import { worldNormalizationNotes } from '../validation/worldSceneWrites';
import type { LegacyContinuationConsent } from '../../workflows/legacyContinuation';
import type { StoryWriting } from '../../domain/storyWriting';
import { storyStreamLimits } from '../../ui/settings/model';
import { DataError } from '../../domain/common';
import { historicalPerspective } from '../../domain/timePreflight';
import { validateStoryEventInteractions } from '../../domain/events/interactions';
import { AiError, manualRetryOnly } from './errors';
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
import { attachFailureDiagnostic, attachObservedRequest, carryFailureDiagnostic, diagnosticSecrets, failurePhase, reasoningTagPresence, scanStoryTags } from './failureDiagnostic';
import type { FailureDiagnostic } from './failureDiagnostic';
import { stageResponses, safeStreamResponseText, responseLimitsFor } from './stageResponses';
import { safeAiError } from './errors';
import { mergeResponseDiagnostics } from './responseContent';
import type { RawResponseObservation, ResponseDiagnostics } from './responseContent';
import { continuationInstruction, mergeContinuation, trimIncompleteTag } from '../../domain/storyContinuation';
import type { StoryFailureText } from '../../domain/storyContinuation';
import { splitLeadingThink } from './compat';

/** 正文续写：已写出的截断原文（已隐藏凭证）。只用于正文阶段。 */
export interface StageRequestOptions extends Omit<RequestOptions, 'tavernType' | 'playerWorldbook'> { frozenStoryChannel?: RequestSnapshot; presetSelection?: AssistantSelection; continuation?: { partial: string; consent?: LegacyContinuationConsent } }
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
  try {
    if (input.stage !== 'story') return await runStageRequestUnchecked(input, config, vault, options, client);
    const selection = options.presetSelection === undefined
      ? captureAssistantPreferences(!options.continuation && !input.legacyNotificationRecovery) : options.presetSelection;
    const storyOptions = { ...options, presetSelection: selection };
    if (options.stream === false && !selection) return await runStageRequestUnchecked(input, config, vault, storyOptions, client);
    const clock = options.storyClock ?? new StoryClock();
    const timeout = options.timeoutSeconds ?? input.settings.runtime.timeoutSeconds;
    const preparation = preparationSeconds(timeout);
    const limits = options.stream === false ? { idle: timeout, total: preparation } : storyStreamLimits(input.settings.runtime);
    return await withStoryPreparation(options.signal, clock, limits, preparation, (signal, prepared) =>
      runStageRequestUnchecked(input, config, vault, { ...storyOptions, storyClock: clock, signal }, client, prepared));
  }
  catch (error) { throw input.stage === 'variables' ? variableFailure(error, 'context') : error; }
}
async function runStageRequestUnchecked(input: ComposeInput & { stage: AiStage }, config: AiConfig,
  vault: CredentialVault, stageOptions: StageRequestOptions, client: AiClient, prepared?: () => void) {
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
  const presetSelection = selected === nativeDeliveryId && !nativeAllowed ? null : structuredClone(selected);
  let writing = captured.stage === 'story' ? await captureStoryWriting(presetSelection, captured.settings.prompts) : undefined;
  if (requestedContinuation && captured.draft?.storyPartial && writing) {
    const previous = captured.draft.storyPartial.writing;
    if (!previous) {
      if (!requestedContinuation.consent?.writing)
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.writing_unknown' });
      if (canonicalJson(requestedContinuation.consent?.writing) !== canonicalJson(writing))
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.writing_changed' });
      writing = { ...writing, prefixSource: 'unknown' };
    } else {
      if (!await canResumeWriting(previous, writing, presetSelection))
        throw new AiError('configuration', undefined, { fieldPath: 'tavern.writing_changed' });
      if (previous.prefixSource) writing = { ...writing, prefixSource: previous.prefixSource };
    }
  }
  const type = requestedContinuation ? 'continue' : captured.draft?.story || captured.draft?.storyPartial
    || captured.draft?.failures.some(f => f.stage === 'story') ? 'regenerate' : 'normal';
  const generation = stageResponses.generation();
  // Formal stages supply the snapshot checked by the live repository before any draft mutation.
  if (!captured.worldview && (requestedContinuation || captured.stage !== 'story')) throw missingWorldview();
  captured.worldview ??= await loadMainWorldview();
  if (options.signal?.aborted) throw new AiError('cancelled');
  const run = () => executePrepared(captured, snapshot, presetSelection, type, config, vault, options, requestedContinuation, client, generation, writing, prepared);
  if (!presetSelection || captured.stage !== 'story' || usesSpreset(presetSelection)) return run();
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
  options: RequestOptions, requestedContinuation: StageRequestOptions['continuation'], client: AiClient, generation: number, writing?: StoryWriting, prepared?: () => void) {
  const prompt = captured.stage === 'variables'
    ? await composeTextVariablesPrompt({ ...captured, stage: 'variables', cotAllowed: snapshot.useCot })
    : await composePrompt({ ...captured, cotAllowed: snapshot.useCot }, presetSelection);
  // 续写：上下文与原请求完全相同（缓存前缀不变），末尾追加已写部分（assistant）与续写指令（user）。
  const continuation = requestedContinuation ? { partial: trimIncompleteTag(requestedContinuation.partial) } : undefined;
  const isolatedLiterature = captured.stage === 'story' && usesSpreset(presetSelection);
  const scripted = captured.stage === 'story' && !!presetSelection && !isolatedLiterature;
  const composed = captured.stage === 'story' && prompt.foundation ? prompt.messages.filter(message => message !== prompt.foundation) : prompt.messages;
  const messages = continuation
    ? [...composed, { role: 'assistant' as const, content: continuation.partial },
      { role: 'user' as const, content: continuationInstruction({ actionOptions: captured.settings.prompts.actionOptions,
        minNarrativeChars: writing?.source === 'native' ? writing.min : undefined, maxNarrativeChars: writing?.source === 'native' ? writing.max : undefined,
        partial: continuation.partial }) }]
    : composed;
  const merged = (text: string) => continuation ? mergeContinuation(continuation.partial, text) : text;
  if (options.signal?.aborted) throw new AiError('cancelled');
  const responseId = stageResponses.begin({ saveId: captured.state.saveId, turnId: captured.draft?.turnId, stage: captured.stage, storyRevision: captured.draft?.storyRevision, protocol: snapshot.channel.protocol, baseSaveRevision: captured.state.revision,
    draftRevision: captured.draft?.draftRevision, executionRevision: captured.draft?.executionRevision,
    stageRequestRevision: captured.stage === 'story' ? undefined : captured.draft?.stageRequestRevisions[captured.stage],
    basedOnEntityRevision: ['variables','world'].includes(captured.stage) ? captured.draft?.entities?.candidateRevision : undefined,
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
  let unverifiedTool: (() => string) | undefined;
  const display = () => {
    const partial = unverifiedTool?.();
    if (!partial && !displayObserved) return {};
    const shown = partial ? displayText + '\n【未完成的工具正文片段，仅供查看】\n' + partial : displayText;
    return { displayText: safeStreamResponseText(shown, secrets), displayOrder };
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
  let playerWorldbook: PlayerWorldbook | undefined = captured.stage === 'story' && prompt.foundation ? { foundation: prompt.foundation } : undefined;
  const storyNotes: string[] = [];
  if (captured.stage === 'story') {
    if (options.signal?.aborted) throw new AiError('cancelled');
    try {
      const worldbook = await prepareStoryWorldbook(storyTriggerInput(captured, type), { signal: options.signal });
      if (worldbook.status === 'ok') {
        playerWorldbook = { ...playerWorldbook, plan: worldbook.plan, history: prompt.presetHistory };
        if (worldbook.incomplete) storyNotes.push('世界书达到扫描工作量上限，本次使用已找到的资料。');
      } else if (worldbook.status === 'skipped') storyNotes.push(prompt.foundation ? worldbook.message.replace('本次未使用玩家世界书', '本次未插入触发条目，主世界书基础资料已保留') : worldbook.message);
    } catch {
      storyNotes.push('世界书触发扫描失败，本次未插入补充条目。');
    }
    if (storyNotes.length) stageResponses.update(responseId, { notes: storyNotes }, secrets);
    if (options.signal?.aborted) throw new AiError('cancelled');
  }
  if (presetSelection === nativeDeliveryId && !captured.draft)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.native_delivery.action' });
  const nativeDeliveryReference = presetSelection === nativeDeliveryId ? nativeReferenceRecords(messages) : undefined;
  const outbound = scripted ? await promptReady(messages, false) : messages;
  if (options.signal?.aborted) throw new AiError('cancelled');
  prepared?.();
  const responseResult = await client.generate(snapshot, outbound, {
    ...options,
    spresetPrototype: isolatedLiterature,
    confirmedTransmission: requestedContinuation?.consent,
    tavernType: scripted ? type : undefined,
    retryableTavernHost: presetSelection === nativeDeliveryId || presetSelection?.definition.id === 'peinture-1118',
    streamTimeouts: captured.stage === 'story' ? storyStreamLimits(captured.settings.runtime) : undefined,
    playerWorldbook,
    presetSampling: prompt.preset?.sampling,
    nativeDeliveryReference,
    storyDeliveryTool: presetSelection && typeof presetSelection === 'object' && isPeinture(presetSelection.definition.id) ? nativeOutputTool : undefined,
    // Only Story may evaluate a complete limit response; other stages remain strict.
    validateStoryOutputLimit: captured.stage === 'story',
    onResponseDiagnostics: (value) => {
      if (sealed || (options.signal?.aborted && !value.tavern)) return;
      diagnostics = mergeResponseDiagnostics(diagnostics, value); observe();
      options.onResponseDiagnostics?.(value);
    },
    onUnverifiedTool: read => {
      if (sealed) return;
      unverifiedTool = read;
      observe();
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
    try { return parseStoryEnvelope(responseText, captured.mode, captured.settings, writing?.source === 'native' ? writing.min : null); }
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
  const result = story ?? (captured.stage === 'entities' ? await parsePartialEntities(responseText, captured.state, captured.draft!) : captured.stage === 'variables'
        ? await parsePartialVariables(responseText, captured.state, captured.draft!)
        : await parsePartialWorld(responseText, captured.state, captured.draft!));
  const notes = envelope ? [...storyNotes, ...envelope.notes] : worldNormalizationNotes.get(result);
  stageResponses.update(responseId, { status: 'validated', normalized: JSON.stringify(result, null, 2), ...(notes ? { notes } : {}) }, secrets);
  return {
    result,
    storyWriting: writing,
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
      basedOnEntityRevision: ['variables','world'].includes(captured.stage) ? captured.draft?.entities?.candidateRevision : undefined,
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
    const failure = (captured.stage === 'variables' || captured.stage === 'entities') ? variableFailure(error, step)
      : captured.stage === 'story' && !compatibilityError ? storyFailure(error, true) : error;
    if (captured.stage === 'story' && usesSpreset(presetSelection) && failure instanceof AiError) manualRetryOnly.add(failure);
    sealed = true;
    if (captured.stage === 'story' && failure && typeof failure === 'object') {
      // 兼容渠道会把推理写成开头的 <think>…</think>：与正式解析一致先去掉，推理不进入可续写的正文。
      const raw = unverifiedTool ? '' : addition ?? received, content = splitLeadingThink(raw).content;
      storyFailureText.set(failure, { writing, produced: raw.trim() !== '',
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
    const requestSecrets = diagnosticSecrets(snapshot);
    attachObservedRequest(failure, {
      preset,
      phase: failurePhase(field, deadline) ?? (step === 'response' && captured.stage === 'story' && !String(field ?? '').startsWith('tavern.') ? 'story_validation' : undefined),
      ...(typeof diagnostics.errorPresent === 'boolean' ? { errorInBody: diagnostics.errorPresent } : {}),
      ...(observedRaw !== undefined ? { contentChars: observedRaw.length } : {}),
      ...(reasoningText !== undefined ? { reasoningChars: reasoningText.length } : {}),
    }, requestSecrets);
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
      if (Object.keys(patch).length) attachFailureDiagnostic(failure, patch, requestSecrets);
      if (reasoningText) attachFailureDiagnostic(failure, { reasoningTags: reasoningTagPresence(reasoningText) }, requestSecrets);
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
  captured.worldview = await loadMainWorldview();
  const { previewStoryMessages } = await import('../../prompts/preview');
  return previewStoryMessages(captured, await composePrompt(captured, selected), type, !usesSpreset(selected));
}
