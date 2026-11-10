import type { WorldEvent } from '../../domain/events/schema';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { fingerprint } from '../../domain/commands';
import { terminalEvent } from '../../domain/events/lifecycle';
import { requireWorld } from './worldDiagnostics';

export function normalizeEventContinuation(event: WorldEvent, old: WorldEvent | undefined,
  base: GameState, draft: TurnDraft, locations: Readonly<GameState['locations']> = base.locations) {
  const plan=event.continuation;
  if(plan?.direction==='protagonist' && plan.entry.locationId)
    requireWorld(locations[plan.entry.locationId], 'invalid_output','event_continuation');
  let expected=old?.protagonistEntry;
  const due=event.eventKind==='sub' ? !old && Date.parse(event.startAt)<=Date.parse(base.worldClock)
    : !event.eventKind && event.estimatedEndAt && Date.parse(event.estimatedEndAt)<=Date.parse(base.worldClock);
  if(plan?.direction==='protagonist' && due && !terminalEvent(event)) {
    const renewed=expected && expected.status!=='pending' && expected.status!=='presented'
      && plan.entry.cue!==expected.cue;
    if(!expected || renewed) {
      expected={id:`entry:${draft.baseSaveRevision}:${draft.storyRevision}`,sourceTurnId:draft.turnId,queuedAt:base.worldClock,
        ...plan.entry,status:'pending'};
    }
  }
  if(expected?.status==='pending') {
    requireWorld(event.status!=='resolved', 'invalid_output','event_entry');
    if(event.status==='cancelled') expected={...expected,status:'invalidated',handledTurnId:draft.turnId,textEvidence:event.resolutionText ?? '事件已取消'};
    else requireWorld(plan?.direction==='protagonist', 'invalid_output','event_entry');
  }
  // Models may omit, retain, or replay exact program metadata, never forge consumption/knowledge.
  requireWorld(!event.protagonistEntry || fingerprint(event.protagonistEntry)===fingerprint(old?.protagonistEntry)
    || fingerprint(event.protagonistEntry)===fingerprint(expected),'permission','event_entry');
  if(expected) event.protagonistEntry=expected; else delete event.protagonistEntry;
}
