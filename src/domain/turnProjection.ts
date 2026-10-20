import { commitCommands } from './commands';
import type { DomainCommand } from './commands';
import type { TurnDraft } from './drafts';
import type { GameState } from './state';

// 每份内存投影都从同一正式基线开始。不能把模拟产生的 revision 当作新正式版本。
export function projectTurn(
  state: GameState,
  draft: TurnDraft,
  worldCommands: readonly DomainCommand[] = [],
) {
  const variables =
    draft.variables?.validation === 'validated' ? draft.variables.result.commands : [];
  return commitCommands(
    state,
    draft.turnId,
    state.revision,
    [...variables, ...worldCommands],
    state.updatedAt,
  );
}
