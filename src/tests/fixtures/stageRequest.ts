import { runStageRequest } from '../../services/ai/runtime';
import { loadMainWorldview } from '../../services/worldbook/mainWorldview';

// Transport tests supply synthetic candidates directly, outside a save or workflow.
export async function requestFixtureStage(
  ...[input, config, vault, options, client]: Parameters<typeof runStageRequest>
) {
  return runStageRequest(
    { ...input, worldview: input.worldview ?? (await loadMainWorldview()) },
    config,
    vault,
    options,
    client,
  );
}
