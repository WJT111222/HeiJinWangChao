import type { WorldEvent } from '../../domain/events/schema';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import { fingerprint } from '../../domain/commands';
import { terminalEvent } from '../../domain/events/lifecycle';
import { conditionEnded } from '../../domain/events/schedule';
import { requireWorld } from './worldEvidence';
import type { WorldEvidence, WorldSource } from './worldEvidence';

/** Administrative planning is distinct from moving/acting for a protected participant. */
export function eventPlanningOnly(old: WorldEvent | undefined, event: WorldEvent) {
  if(!old || terminalEvent(old)) return false;
  const planning = new Set(['continuation','protagonistEntry','estimatedEndAt','sourceTurnIds']);
  const actual=(value:WorldEvent)=>Object.fromEntries(Object.entries(value).filter(([key])=>!planning.has(key)));
  return fingerprint(actual(old))===fingerprint(actual(event));
}
export function normalizeEventContinuation(event: WorldEvent, old: WorldEvent | undefined,
  proof: WorldEvidence, origins: readonly WorldSource[], base: GameState, causal: GameState, draft: TurnDraft) {
  const plan=event.continuation;
  if(plan?.direction==='protagonist' && plan.entry.locationId)
    requireWorld(base.locations[plan.entry.locationId], 'invalid_output','event_continuation');
  if(old?.continuation && fingerprint(old.continuation)!==fingerprint(plan)) {
    requireWorld(plan && proof.sources.includes(`event:${event.id}`) && proof.rationale.trim(), 'invalid_output','event_continuation');
    // Same-response causal reasoning may use a real actor's motive; the old event alone is not a new development.
    requireWorld(origins.some(source=>source.id==='story:current' || (source.id!==`event:${event.id}` && source.knowledge!=='statement'
      && (source.knowledge==='fact' || source.knowledge==='motive'))), 'invalid_output','event_continuation');
  }
  let expected=old?.protagonistEntry;
  const due=event.estimatedEndAt && Date.parse(event.estimatedEndAt)<=Date.parse(base.worldClock);
  if(plan?.direction==='protagonist' && due && !terminalEvent(event)) {
    const renewed=expected && expected.status!=='pending' && expected.status!=='presented'
      && plan.entry.cue!==expected.cue && proof.kind==='established'
      && origins.some(source=>source.id==='story:current' && source.text.includes(plan.entry.cue));
    if(!expected || renewed) {
      requireWorld(Date.parse(proof.at)>=Date.parse(event.estimatedEndAt!), 'invalid_output','event_time');
      requireWorld(proof.kind!=='planned' && [...event.prerequisites,...event.blockers].every(ref=>conditionEnded(causal,ref,proof.at)), 'invalid_output','completion_conditions');
      expected={id:`entry:${draft.baseSaveRevision}:${draft.storyRevision}`,sourceTurnId:draft.turnId,queuedAt:proof.at,
        ...plan.entry,status:'pending'};
    }
  }
  if(expected?.status==='pending') {
    requireWorld(event.status!=='resolved', 'invalid_output','event_entry');
    if(event.status==='cancelled') expected={...expected,status:'invalidated',handledTurnId:draft.turnId,textEvidence:proof.fact};
    else requireWorld(plan?.direction==='protagonist', 'invalid_output','event_entry');
  }
  // Models may omit, retain, or replay exact program metadata, never forge consumption/knowledge.
  requireWorld(!event.protagonistEntry || fingerprint(event.protagonistEntry)===fingerprint(old?.protagonistEntry)
    || fingerprint(event.protagonistEntry)===fingerprint(expected),'permission','event_entry');
  if(expected) event.protagonistEntry=expected; else delete event.protagonistEntry;
}
