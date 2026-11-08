import type { GameState } from '../state';
import type { TurnDraft } from '../drafts';

// The validated Variables projection is the current scene, not the scene at turn start.
// Opening companions retain their existing additional protection.
export function worldNpcAllowed(state: GameState, draft: TurnDraft, npcId: string) {
  return Boolean(state.npc[npcId] && !state.npc[npcId].onScene
    && !(draft.turnKind === 'opening' && state.initialCompanionId === npcId));
}
