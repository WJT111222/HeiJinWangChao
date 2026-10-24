import { AiError } from './errors';
import { browserPromptOrder } from '../../prompts/order';
import { composePrompt } from '../../prompts/composer';
import { checkedInput } from '../../prompts/context';
import type { ComposeInput } from '../../prompts/context';
import { parseStoryEnvelope, parseVariables, parseWorld } from '../validation/aiOutputs';
import type { AiConfig, AiStage } from './configuration';
import type { CredentialVault } from './credentials';
import { requestSnapshot } from './snapshot';
import { AiClient } from './client';
import type { RequestOptions } from './client';
import { timeOutcome } from '../../domain/timePreflight';

// 独立阶段请求入口；没有 SaveRepository、写库、重试或自动执行下游阶段。
export async function runStageRequest(
  input: ComposeInput & { stage: AiStage },
  config: AiConfig,
  vault: CredentialVault,
  options: RequestOptions = {},
  client = new AiClient(),
) {
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
  const prompt = await composePrompt({ ...captured, cotAllowed: snapshot.useCot });
  const response = await client.generate(snapshot, prompt.messages, {
    ...options,
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
  const envelope = captured.stage === 'story' ? parseStoryEnvelope(response.text, captured.mode, captured.settings) : undefined;
  const story = envelope?.story;
  if (story) {
    try { timeOutcome(captured.state, { userInput: captured.userInput, turnKind: captured.mode, story }, true); }
    catch { throw new AiError('time_preflight'); }
  }
  const result = story ?? (captured.stage === 'variables'
        ? parseVariables(response.text, captured.state, captured.draft!)
        : parseWorld(response.text, captured.state, captured.draft!));
  return {
    result,
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
}
