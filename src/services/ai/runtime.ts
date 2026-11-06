import { DataError } from '../../domain/common';
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
import { timeOutcome } from '../../domain/timePreflight';
import { stageResponses } from './stageResponses';
import { safeAiError } from './errors';

// 独立阶段请求入口；没有 SaveRepository、写库、重试或自动执行下游阶段。
export async function runStageRequest(
  input: ComposeInput & { stage: AiStage },
  config: AiConfig,
  vault: CredentialVault,
  options: RequestOptions = {},
  client = new AiClient(),
) {
  try { return await runStageRequestUnchecked(input, config, vault, options, client); }
  catch (error) { throw input.stage === 'variables' ? variableFailure(error, 'context') : error; }
}
async function runStageRequestUnchecked(input: ComposeInput & { stage: AiStage }, config: AiConfig,
  vault: CredentialVault, options: RequestOptions, client: AiClient) {
  if (input.orderOverrides && input.orderPreferences) throw new AiError('configuration');
  const captured = checkedInput({
    ...input,
    orderPreferences: input.orderOverrides
      ? undefined
      : (input.orderPreferences ?? browserPromptOrder()),
  }) as ComposeInput & { stage: AiStage };
  if (captured.stage === 'world' && captured.draft?.variables?.validation === 'validated')
    parseVariables(JSON.stringify(captured.draft.variables.result), captured.state, captured.draft);
  const snapshot = requestSnapshot(config, captured.stage, vault);
  const prompt = captured.stage === 'variables'
    ? await composeTextVariablesPrompt({ ...captured, stage: 'variables', cotAllowed: snapshot.useCot })
    : await composePrompt({ ...captured, cotAllowed: snapshot.useCot });
  const responseId = stageResponses.begin({ saveId: captured.state.saveId, turnId: captured.draft?.turnId, stage: captured.stage, storyRevision: captured.draft?.storyRevision });
  const secrets = config.channels.map(channel => vault.get(channel.id)).filter(Boolean);
  let received = '';
  let step: 'request' | 'response' = 'request';
  try {
  const response = await client.generate(snapshot, prompt.messages, {
    ...options,
    onDelta: (delta) => { received += delta; options.onDelta?.(delta); },
    inspection: {
      kind: 'stage',
      mode: captured.mode,
      saveId: captured.state.saveId,
      revision: captured.state.revision,
      storyRevision: captured.draft?.storyRevision,
      modules: prompt.modules,
    },
    timeoutSeconds: options.timeoutSeconds ?? captured.settings.runtime.timeoutSeconds,
    stream: options.stream ?? captured.stage === 'story',
  });
  step = 'response';
  received = response.text;
  stageResponses.update(responseId, { text: received, status: 'received' }, secrets);
  const envelope = captured.stage === 'story' ? parseStoryEnvelope(response.text, captured.mode, captured.settings) : undefined;
  const story = envelope?.story;
  if (story) {
    try { validateStoryEventInteractions(captured.state, story); }
    catch (error) {
      if (error instanceof DataError && error.code==='EVENT_ENTRY') throw new AiError('event_entry');
      throw error;
    }
    try { timeOutcome(captured.state, { userInput: captured.userInput, turnKind: captured.mode, story }, true); }
    catch (error) { throw variableValidationError(error); }
  }
  const result = story ?? (captured.stage === 'variables'
        ? await parseTextVariables(response.text, captured.state, captured.draft!)
        : parseWorld(response.text, captured.state, captured.draft!));
  stageResponses.update(responseId, { status: 'validated', normalized: JSON.stringify(result, null, 2) }, secrets);
  return {
    result,
    responseInspectionId: responseId,
    // 临时诊断单独返回；StorySchema和后续阶段永远不接收这些字段。
    storyInspection: envelope ? { planning: envelope.planning, nativeReasoning: response.nativeReasoning } : undefined,
    usage: response.usage,
    diagnostics: response.diagnostics,
    modules: prompt.modules,
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
    const failure = captured.stage === 'variables' ? variableFailure(error, step) : error;
    stageResponses.update(responseId, { status: 'failed', ...(received ? { text: received } : {}), error: safeAiError(failure) }, secrets);
    throw failure;
  }
}
