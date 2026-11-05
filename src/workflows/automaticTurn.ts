import { completeTurnDraft } from '../domain/turnCommit';
import type { SaveRepository } from '../services/storage/saveRepository';
import type { TurnCoordinator, TurnInput } from './turnCoordinator';

/** 协调器退出并释放共享锁后才提交，提交仍执行完整重验/CAS/持久幂等回执。 */
export async function generateAndSettleTurn(runner: TurnCoordinator, repository: Pick<SaveRepository, 'commitTurn'>, input: TurnInput,
  control: { check: () => void; onSettling: () => void }) {
  const outcome = await runner.generate(input);
  control.check();
  if (outcome.status !== 'complete' || !completeTurnDraft(outcome.draft)) return { outcome };
  control.onSettling();
  control.check();
  const committed = await repository.commitTurn({ draft: outcome.draft, nextAction: '',
    useVariableStage: outcome.draft.useVariableStage, useWorldStage: outcome.draft.useWorldStage });
  return { outcome, committed };
}
