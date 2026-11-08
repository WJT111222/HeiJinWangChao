import { normalizeEventContinuation } from './worldEventContinuation';
import { historicalEvent, terminalEvent } from '../../domain/events/lifecycle';
import { conditionEnded, worldEventSchedule } from '../../domain/events/schedule';
import { WorldEventSchema } from '../../domain/events/schema';
import { historicalPerspective } from '../../domain/timePreflight';
import { openingTimeBase } from '../../domain/openingTime';
import { hasKnownPlayerConnection } from '../../domain/npc/contactReview';
import { orderWorldCommands } from './worldDependencies';
import { fingerprint } from '../../domain/commands';
import type { ActorRef } from '../../domain/common';
import { WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { protagonistKnownEvent } from '../../domain/events/knowledge';
import { worldTypes } from './commandCatalog';
import { requireWorld, worldValidationError } from './worldDiagnostics';
import { worldProjectionError } from './worldProjectionDiagnostics';
import { worldNpcAllowed } from '../../domain/npc/worldAccess';

function sameActor(a: ActorRef, b: ActorRef) { return a.kind === b.kind && a.id === b.id; }
function offscreen(state: GameState, ref: ActorRef) {
  return ref.kind === 'npc' ? Boolean(state.npc[ref.id] && !state.npc[ref.id].onScene)
    : ref.kind === 'organization' && Boolean(state.organizations[ref.id]);
}
function readyConditions(state: GameState, conditions: readonly string[], at: string) {
  return conditions.every(ref => conditionEnded(state, ref, at));
}
export function validateWorldOutput(raw: unknown, state: GameState, draft: TurnDraft) {
  try { return validateWorldOutputChecked(raw, state, draft); }
  catch (error) { throw worldValidationError(error, {}, raw); }
}
function validateWorldOutputChecked(raw: unknown, state: GameState, draft: TurnDraft) {
  const original = state;
  state = openingTimeBase(state, draft);
  const result = WorldResultSchema.parse(raw);
  requireWorld(draft.story, 'invalid_output', 'command_structure');
  const base = projectTurn(original, draft), now = Date.parse(base.worldClock);
  const commands = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
  const allowed = new Set<string>(worldTypes);
  for (const command of result.worldCommands) requireWorld(allowed.has(command.type), 'permission');
  for (const command of result.taskCommands) requireWorld(command.type === 'SaveTask', 'permission');
  for (const command of result.eventCommands) requireWorld(['SaveEvent','DeleteEvent'].includes(command.type), 'permission');
  const variableIds = base.appliedCommands.filter(entry => entry.turnId === draft.turnId).map(entry => entry.commandId);
  const ids = [...variableIds, ...commands.map(command => command.commandId)];
  requireWorld(new Set(ids).size === ids.length);
  const effects = commands.map(command => fingerprint({ ...command, commandId: '' }));
  requireWorld(new Set(effects).size === effects.length);
  const entityKeys = commands.flatMap(c => c.type === 'SaveTask' ? [`task:${c.task.id}`]
    : c.type === 'SaveEvent' ? [`event:${c.event.id}`]
      : c.type === 'DeleteEvent' ? [`cleanup:${c.eventId}`] : []);
  requireWorld(new Set(entityKeys).size === entityKeys.length);
  const createdNpcs = new Map(result.worldCommands.flatMap(c => c.type === 'CreateNpc' ? [[c.npc.id, c.npc] as const] : []));
  const createdOrgs = new Map(result.worldCommands.flatMap(c => c.type === 'CreateOrganization' ? [[c.organization.id, c.organization] as const] : []));
  const actorAllowed = (ref: ActorRef) =>
    (ref.kind === 'npc' ? worldNpcAllowed(base, draft, ref.id) : offscreen(base, ref))
    || (ref.kind === 'npc' && createdNpcs.has(ref.id) && !createdNpcs.get(ref.id)?.onScene)
    || (ref.kind === 'organization' && createdOrgs.has(ref.id));
  const causal = structuredClone(base);
  // Only structured ID dependencies are ordered. Evidence is a non-executing explanation.
  for (const command of orderWorldCommands(commands)) {
    const group = result.worldCommands.includes(command) ? 'worldCommands' : result.taskCommands.includes(command) ? 'taskCommands' : 'eventCommands';
    const fieldPath = `${group}.${result[group].indexOf(command)}`;
    try {
      switch (command.type) {
        case 'UpdateNpc': {
          requireWorld(causal.npc[command.npcId] && actorAllowed({kind:'npc', id:command.npcId}), 'permission');
          requireWorld(!command.affinityChange && command.changes.relationshipText === undefined
            && command.changes.lastInteractionAt === undefined && command.changes.onScene !== true, 'permission');
          // A departing actor can take a new background task, not overwrite the same scene fields twice.
          if (state.npc[command.npcId]?.onScene) {
            const prior = draft.variables?.validation === 'validated' ? draft.variables.result.commands : [];
            requireWorld(!prior.some(c => c.type === 'UpdateNpc' && c.npcId === command.npcId
              && Object.keys(c.changes).some(key => Object.hasOwn(command.changes, key))), 'permission', 'scene_write_conflict');
          }
          break;
        }
        case 'RecordNpcMemory': {
          requireWorld(causal.npc[command.npcId] && actorAllowed({kind:'npc', id:command.npcId}), 'permission');
          requireWorld(Date.parse(command.memory.createdAtGameTime) >= Date.parse(state.worldClock)
            && Date.parse(command.memory.createdAtGameTime) <= now, 'invalid_output', 'event_time');
          break;
        }
        case 'CreateNpc': {
          const npc = command.npc;
          requireWorld(!npc.onScene && !npc.lastInteractionAt && npc.affinity === 0 && !npc.affinityConfirmed
            && !npc.memories.length && !npc.knownInformation.length
            && (npc.kind !== 'special' || !npc.longTermMemories.length), 'permission');
          break;
        }
        case 'CreateOrganization': {
          const org = command.organization;
          requireWorld(!org.relationHistory.length, 'permission', 'organization_initialization');
          requireWorld(!Object.values(base.organizations).some(known => known.kind === org.kind && known.name === org.name));
          requireWorld((org.kind !== 'gang' || org.funds === undefined)
            && (org.kind !== 'business' || (org.assetsEstimate === undefined && org.liquidityEstimate === undefined)), 'permission');
          break;
        }
        case 'RecordOrgRelation':
          requireWorld(causal.organizations[command.organizationId], 'permission');
          break;
        case 'CreateLocation': break; // Domain validation enforces hierarchy and references.
        case 'RetireNpc': {
          const npc = base.npc[command.npcId];
          requireWorld(npc && actorAllowed({kind:'npc',id:npc.id}) && base.initialCompanionId !== npc.id, 'permission');
          if (base.contactReviewNpcIds.includes(npc.id)) {
            const review = command.contactReview;
            requireWorld(review?.conclusion === 'non_contact' && review.basis === 'no_known_connection'
              && !hasKnownPlayerConnection(base, npc.id), 'permission');
          }
          break;
        }
        case 'SaveTask': {
          const task = command.task, old = base.tasks[task.id], formal = state.tasks[task.id];
          requireWorld(!formal || sameActor(formal.actorRef, task.actorRef), 'permission');
          requireWorld(actorAllowed(task.actorRef) && (!old || sameActor(old.actorRef, task.actorRef)), 'permission', 'actor_permission', 'task.actorRef');
          if (task.handoff && !old) {
            const transfer = task.handoff, prior = causal.tasks[transfer.fromTaskId];
            requireWorld(prior?.resolution && ['completed','cancelled'].includes(prior.status), 'invalid_output', 'task_state');
            requireWorld(actorAllowed(prior.actorRef), 'permission');
            requireWorld(Date.parse(transfer.at) >= Date.parse(state.worldClock)
              && Date.parse(prior.resolution.at) <= Date.parse(transfer.at)
              && Date.parse(transfer.at) <= Date.parse(task.startAt) && Date.parse(transfer.at) <= now, 'invalid_output', 'event_time');
          }
          if (old) {
            requireWorld(old.goal === task.goal && old.startAt === task.startAt && old.completionCondition === task.completionCondition);
            if (['completed','cancelled'].includes(old.status)) requireWorld(fingerprint(old) === fingerprint(task), 'invalid_output', 'task_state');
            if (['active','blocked'].includes(old.status)) requireWorld(task.status !== 'planned', 'invalid_output', 'task_state', 'task.status');
          } else requireWorld(!Object.values(base.tasks).some(known => sameActor(known.actorRef,task.actorRef)
            && known.goal === task.goal && known.startAt === task.startAt));
          if (['active','blocked','completed'].includes(task.status)) requireWorld(Date.parse(task.startAt) <= now, 'invalid_output','task_state', 'task.startAt');
          if (task.status === 'active' || task.status === 'completed') requireWorld(readyConditions(causal,
            [...(old?.prerequisites ?? []), ...(old?.blockers ?? []), ...task.prerequisites, ...task.blockers],task.resolution?.at ?? base.worldClock), 'invalid_output','completion_conditions');
          if (task.status === 'completed' || task.status === 'cancelled') {
            if (!old || !['completed','cancelled'].includes(old.status)) {
              requireWorld(task.resolution && task.resolution.sourceTurnId === draft.turnId, 'invalid_output','task_state', 'task.resolution');
              requireWorld(Date.parse(task.resolution.at) >= Date.parse(state.worldClock)
                && Date.parse(task.resolution.at) <= now, 'invalid_output','event_time', 'task.resolution.at');
            }
          } else requireWorld(task.resolution === undefined, 'invalid_output','task_state', 'task.resolution');
          break;
        }
        case 'SaveEvent': {
          const event = command.event, old = base.events[event.id];
          if (!old || !terminalEvent(event)) {
            const checked = WorldEventSchema.safeParse(event);
            if (!checked.success) throw worldValidationError(checked.error,{fieldPath:'event',worldRule:'event_plan'});
          }
          requireWorld(!event.estimatedEndAt || Date.parse(event.estimatedEndAt) >= Date.parse(event.startAt), 'invalid_output','event_time', 'event.estimatedEndAt');
          if (!terminalEvent(event)) requireWorld(event.resolvedAt === undefined && event.resolutionText === undefined && event.resultKnowledge === undefined);
          if (event.resolvedAt) requireWorld(Date.parse(event.resolvedAt) <= now, 'invalid_output','event_time', 'event.resolvedAt');
          // Event participants record identities; they do not execute movements, payments or player decisions.
          event.actorRefs.forEach((ref, index) => requireWorld(ref.kind === 'protagonist' ? ref.id === base.protagonist.id
            : ref.kind === 'organization' ? Boolean(causal.organizations[ref.id])
              : Boolean(causal.npc[ref.id] || (base.retiredNpcs[ref.id] && old?.actorRefs.some(prior => sameActor(prior,ref)))), 'permission', 'actor_permission', `event.actorRefs.${index}`));
          if (old) {
            requireWorld(old.startAt === event.startAt
              && old.completionCondition === event.completionCondition);
            if (terminalEvent(old)) requireWorld(fingerprint(old) === fingerprint(event), 'invalid_output','event_transition');
            if (['active','blocked'].includes(old.status)) requireWorld(event.status !== 'scheduled', 'invalid_output','event_transition', 'event.status');
          } else requireWorld(!Object.values(base.events).some(known => known.title === event.title
            && known.startAt === event.startAt && fingerprint(known.actorRefs) === fingerprint(event.actorRefs)));
          for (const id of event.predecessorEventIds ?? []) {
            const prior = historicalEvent(causal,id);
            requireWorld(prior && terminalEvent(prior) && prior.resolvedAt
              && Date.parse(prior.resolvedAt) <= Date.parse(event.startAt), 'invalid_output','event_transition');
          }
          const knownTurns = new Set([draft.turnId, ...state.journal.map(entry => entry.turnId)]);
          requireWorld(event.sourceTurnIds.includes(draft.turnId) && event.sourceTurnIds.every(id => knownTurns.has(id))
            && (old?.sourceTurnIds ?? []).every(id => event.sourceTurnIds.includes(id)));
          if (['active','blocked','resolved'].includes(event.status)) requireWorld(Date.parse(event.startAt) <= now, 'invalid_output','event_time');
          if (event.status === 'active' || (event.status === 'resolved' && event.outcome !== 'failure'))
            requireWorld(readyConditions(causal,[...(old?.prerequisites ?? []),...(old?.blockers ?? []),...event.prerequisites,...event.blockers],event.resolvedAt ?? base.worldClock), 'invalid_output','completion_conditions');
          if (event.status === 'resolved') requireWorld(event.resolvedAt && event.resolutionText?.trim(), 'invalid_output','event_transition');
          // Objective progress never implicitly refreshes an already held character snapshot.
          if (!old || !terminalEvent(old)) {
            const prior = old && protagonistKnownEvent(old);
            const snapshot = prior ? {worldUpdateTurnId:draft.turnId,title:prior.title,startAt:prior.startAt,status:prior.status,
              ...(prior.resolutionText === undefined ? {} : {resolutionText:prior.resolutionText}),
              ...('notice' in prior ? {notice:prior.notice,knowledgeKind:prior.knowledgeKind} : {})} : undefined;
            requireWorld(!event.protagonistKnowledge || fingerprint(event.protagonistKnowledge) === fingerprint(old?.protagonistKnowledge)
              || fingerprint(event.protagonistKnowledge) === fingerprint(snapshot), 'permission');
            if (snapshot) {
              event.protagonistKnowledge = snapshot;
              event.sourceTurnIds = [...event.sourceTurnIds.filter(id => id !== draft.turnId),draft.turnId];
            } else delete event.protagonistKnowledge;
          }
          normalizeEventContinuation(event,old,base,causal,draft);
          break;
        }
        case 'RecordHistory': break; // 只记录，不广播知识；引用/日期/ID由同一领域投影验证。
        case 'DeleteEvent': {
          const event = historicalEvent(causal,command.eventId);
          requireWorld(event && terminalEvent(event), 'invalid_output','event_transition');
          requireWorld(causal.events[command.eventId]?.status === command.expectedStatus);
          break;
        }
        default: requireWorld(false,'permission');
      }
      if (command.type === 'CreateNpc') causal.npc[command.npc.id] = command.npc;
      if (command.type === 'CreateOrganization') causal.organizations[command.organization.id] = command.organization;
      if (command.type === 'CreateLocation') causal.locations[command.location.id] = command.location;
      if (command.type === 'SaveTask') causal.tasks[command.task.id] = command.task;
      if (command.type === 'SaveEvent') causal.events[command.event.id] = command.event;
    } catch (error) { throw worldValidationError(error,{fieldPath,commandIndex:commands.indexOf(command),commandType:command.type}); }
  }
  let projected: GameState;
  try { projected = projectTurn(original, draft, commands); }
  catch (error) { throw worldProjectionError(error, result, original, draft); }
  if (draft.variables?.validation === 'validated' && !historicalPerspective(state,draft)) for (const due of worldEventSchedule(state,base).due) {
    const after=projected.events[due.eventId] ?? projected.retiredEvents[due.eventId];
    requireWorld(after && (terminalEvent(after) || ('estimatedEndAt' in after && after.estimatedEndAt && Date.parse(after.estimatedEndAt)>Date.parse(base.worldClock)) || ('protagonistEntry' in after && ['pending','presented'].includes(after.protagonistEntry?.status??''))), 'invalid_output', 'due_event_unhandled');
  }
  for(const command of result.eventCommands) if(command.type==='SaveEvent' && !terminalEvent(command.event))
    requireWorld(['pending','presented'].includes(command.event.protagonistEntry?.status??'') || (command.event.estimatedEndAt && Date.parse(command.event.estimatedEndAt)>Date.parse(base.worldClock)));
  // A world continuation is a necessary live successor, never an instant chain of finished events.
  for(const command of result.eventCommands) if(command.type==='SaveEvent' && terminalEvent(command.event) && command.event.continuation?.direction==='world') {
    const successors=result.eventCommands.filter(c=>c.type==='SaveEvent' && c.event.predecessorEventIds?.includes(command.event.id));
    requireWorld(successors.length>0 && successors.every(c=>c.type==='SaveEvent' && !terminalEvent(c.event)), 'invalid_output','event_continuation');
  }
  return result;
}
