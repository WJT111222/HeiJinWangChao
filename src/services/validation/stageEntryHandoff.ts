import { fingerprint } from '../../domain/commands';
import type { WorldResultSchema, TurnDraft } from '../../domain/drafts';
import type { z } from 'zod';
import type { GameState } from '../../domain/state';
import { terminalEvent } from '../../domain/events/lifecycle';
import { requireWorld } from './worldDiagnostics';

/** Carry an unfinished interaction to an explicit legacy successor, never accept/decline for the player. */
export function normalizeStageEntryHandoffs(result:z.infer<typeof WorldResultSchema>,base:GameState,draft:TurnDraft) {
  const normalized=new Set<string>();
  for(const source of result.eventCommands) {
    if(source.type!=='SaveEvent'||source.event.eventKind!=='sub'||!terminalEvent(source.event))continue;
    const old=base.events[source.event.id],entry=old?.protagonistEntry;
    if(!entry||!['pending','presented'].includes(entry.status))continue;
    requireWorld(Date.parse(source.event.resolvedAt!)===Date.parse(source.event.fixedEndAt!), 'invalid_output','event_time');
    const targets=result.eventCommands.filter(c=>c.type==='SaveEvent'&&!c.event.eventKind&&!terminalEvent(c.event)
      && c.event.predecessorEventIds?.includes(source.event.id)&&c.event.continuation?.direction==='protagonist');
    if(entry.status==='pending' && targets.length===0 && source.event.continuation?.direction!=='protagonist') {
      const closed={...entry,status:'invalidated' as const,handledTurnId:draft.turnId,textEvidence:'阶段到期，未呈现的原入场安排已结束'};
      requireWorld(!source.event.protagonistEntry || fingerprint(source.event.protagonistEntry)===fingerprint(entry)
        || fingerprint(source.event.protagonistEntry)===fingerprint(closed),'permission','event_entry');
      source.event.protagonistEntry=closed; normalized.add(source.event.id); continue;
    }
    requireWorld(targets.length===1 && targets[0].type==='SaveEvent','invalid_output','event_entry');
    const target=targets[0].event;
    requireWorld(!base.events[target.id] && target.continuation?.direction==='protagonist'
      && target.continuation.entry.cue===entry.cue && target.continuation.entry.channel===entry.channel
      && target.continuation.entry.locationId===entry.locationId,'permission','event_entry');
    const invalidated={...entry,status:'invalidated' as const,handledTurnId:draft.turnId,textEvidence:'阶段固定到期，入场职责转交后续事件'};
    const transferred={...entry,id:`stage-entry:${base.revision}`};
    requireWorld(!normalized.has(target.id),'invalid_output','event_entry');
    // Entry IDs are scoped by target event ID, as in the existing entry protocol.
    requireWorld(transferred.id.length<=128,'invalid_output','event_entry');
    requireWorld(!source.event.protagonistEntry || fingerprint(source.event.protagonistEntry)===fingerprint(entry)
      || fingerprint(source.event.protagonistEntry)===fingerprint(invalidated),'permission','event_entry');
    requireWorld(!target.protagonistEntry || fingerprint(target.protagonistEntry)===fingerprint(transferred),'permission','event_entry');
    normalized.add(source.event.id); normalized.add(target.id);
    source.event.protagonistEntry=invalidated; target.protagonistEntry=transferred;
    target.sourceTurnIds=[...new Set([...target.sourceTurnIds,...old.sourceTurnIds])];
  }
  return normalized;
}
