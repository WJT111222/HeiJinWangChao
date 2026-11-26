import type { GameState } from '../state';
import type { TurnDraft } from '../drafts';

export function worldTaskNpcAllowed(state: GameState, draft: TurnDraft, npcId: string) {
  return Boolean(state.npc[npcId] && !state.npc[npcId].onScene &&
    !(draft.turnKind === 'opening' && state.initialCompanionId === npcId));
}

/** Personal writes are owned by the stage that handled contact, including after departure. */
export function worldNpcAllowed(state: GameState, draft: TurnDraft, npcId: string, original: GameState = state) {
  return worldTaskNpcAllowed(state, draft, npcId) && !original.npc[npcId]?.onScene &&
    !draft.entities?.contactedNpcIds.includes(npcId) && !(draft.phoneFreeze && draft.phonePending?.some(row => row.reply.npcId === npcId));
}
