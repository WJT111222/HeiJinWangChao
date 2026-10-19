import { composePrompt } from '../../prompts/composer';
import { checkedInput } from '../../prompts/context';
import type { ComposeInput } from '../../prompts/context';
import { parseStory, parseVariables, parseWorld } from '../validation/aiOutputs';
import type { AiConfig, AiStage } from './configuration';
import type { CredentialVault } from './credentials';
import { requestSnapshot } from './snapshot';
import { AiClient } from './client';
import type { RequestOptions } from './client';

// 独立阶段请求入口；没有 SaveRepository、写库、重试或自动执行下游阶段。
export async function runStageRequest(
  input: ComposeInput & { stage: AiStage },
  config: AiConfig,
  vault: CredentialVault,
  options: RequestOptions = {},
  client = new AiClient(),
) {
  const captured = checkedInput(input) as ComposeInput & { stage: AiStage };
  const snapshot = requestSnapshot(config, captured.stage, vault);
  const prompt = await composePrompt({ ...captured, cotAllowed: snapshot.useCot });
  const response = await client.generate(snapshot, prompt.messages, {
    ...options,
    timeoutSeconds: options.timeoutSeconds ?? captured.settings.runtime.timeoutSeconds,
    stream: options.stream ?? captured.stage === 'story',
  });
  const result =
    captured.stage === 'story'
      ? parseStory(response.text, captured.mode, captured.settings)
      : captured.stage === 'variables'
        ? parseVariables(response.text, captured.state, captured.draft!)
        : parseWorld(response.text, captured.state, captured.draft!);
  return {
    result,
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
