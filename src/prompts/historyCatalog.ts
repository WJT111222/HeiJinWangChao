import type { TurnDraft } from '../domain/drafts';
import type { GameState } from '../domain/state';
import { terminalEvent } from '../domain/events/lifecycle';
import { historicalPerspective } from '../domain/timePreflight';
import { offscreenGroups } from '../domain/stageCommands';

/** World may create and conclude an event in the same batch, even with an empty schedule. */
export function historyCatalogReason(state: GameState, draft: TurnDraft) {
  if (historicalPerspective(state, draft)) return '回顾往事';
  if (draft.variables?.result.commands.some(c => c.type === 'SaveEvent' && terminalEvent(c.event)))
    return '现场阶段已有结案候选';
  if (offscreenGroups.eventCommands.includes('SaveEvent')) return '场外阶段可在本批结案';
}
