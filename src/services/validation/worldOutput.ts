import type { z } from 'zod';
import { normalizeStageEntryHandoffs } from './stageEntryHandoff';
import { deferredStageIds, validateStageSettlement } from '../../domain/events/stages';
import { normalizeEventContinuation } from './worldEventContinuation';
import { historicalEvent, terminalEvent } from '../../domain/events/lifecycle';
import { worldEventSchedule } from '../../domain/events/schedule';
import { plannedEventSchema } from '../../domain/events/schema';
import { historicalPerspective } from '../../domain/timePreflight';
import { openingTimeBase } from '../../domain/openingTime';
import { orderWorldCommands } from './worldDependencies';
import { fingerprint } from '../../domain/commands';
import type { DomainCommand } from '../../domain/commands';
import type { ActorRef } from '../../domain/common';
import { WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { protagonistKnownEvent } from '../../domain/events/knowledge';
import { worldTypes } from './commandCatalog';
import { requireWorld, safeWorldPath, worldValidationError } from './worldDiagnostics';
import { worldProjectionError } from './worldProjectionDiagnostics';
import { worldNpcAllowed } from '../../domain/npc/worldAccess';
import { NpcSchema } from '../../domain/npc/schema';
import { stripVariableSceneWrites, worldForbiddenNpcChange, worldNormalizationNotes } from './worldSceneWrites';
import { keepTaskIdentity, sameTaskInstant, sameTaskText } from './worldTaskIdentity';

function sameActor(a: ActorRef, b: ActorRef) { return a.kind === b.kind && a.id === b.id; }
function offscreen(state: GameState, ref: ActorRef) {
  return ref.kind === 'npc' ? Boolean(state.npc[ref.id] && !state.npc[ref.id].onScene)
    : ref.kind === 'organization' && Boolean(state.organizations[ref.id]);
}
function changedRecordField(prefix: 'task' | 'event', previous: Record<string, unknown>, candidate: Record<string, unknown>) {
  const field = [...new Set([...Object.keys(previous), ...Object.keys(candidate)])]
    .sort().find(key => fingerprint(previous[key]) !== fingerprint(candidate[key]));
  return field ? safeWorldPath([prefix,field]) : prefix;
}
export function validateWorldOutput(raw: unknown, state: GameState, draft: TurnDraft, allowDeferred = false) {
  try { return validateWorldOutputChecked(raw, state, draft, allowDeferred); }
  catch (error) { throw worldValidationError(error, {}, raw); }
}
function validateWorldOutputChecked(raw: unknown, state: GameState, draft: TurnDraft, allowDeferred: boolean) {
  const original = state;
  state = openingTimeBase(state, draft);
  const result: z.infer<typeof WorldResultSchema> = WorldResultSchema.omit({ settlement: true, deferredEvents: true }).parse(raw);
  requireWorld(draft.story, 'invalid_output', 'command_structure');
  const base = projectTurn(original, draft), now = Date.parse(base.worldClock);
  const groups = ['worldCommands', 'taskCommands', 'eventCommands'] as const;
  const entries = groups.flatMap(group => result[group].map((command,index) => ({
    command, group, fieldPath: `${group}.${index}`,
  })));
  const scopes = new Map(entries.map(({command,fieldPath},commandIndex) => [
    command, {fieldPath,commandIndex,commandType:command.type},
  ]));
  const scope = (command: DomainCommand) => scopes.get(command)!;
  const allowed = new Set<string>(worldTypes);
  // Validate the original groups before any normalization can remove commands.
  for (const {command,group} of entries) {
    try {
      requireWorld(group === 'worldCommands' ? allowed.has(command.type)
        : group === 'taskCommands' ? command.type === 'SaveTask'
          : ['SaveEvent', 'DeleteEvent'].includes(command.type), 'permission', 'command_structure');
    } catch (error) {
      throw worldValidationError(error, scope(command));
    }
  }
  const variableIds = base.appliedCommands.filter(entry => entry.turnId === draft.turnId).map(entry => entry.commandId);
  const ids = new Set(variableIds), effects = new Set<string>(), entities = new Set<string>(), newTaskPayloads = new Set<string>();
  requireWorld(ids.size === variableIds.length, 'invalid_output', 'command_structure', 'state.appliedCommands');
  for (const {command} of entries) {
    try {
      requireWorld(!ids.has(command.commandId), 'invalid_output', 'command_structure', 'commandId');
      ids.add(command.commandId);
      const entity = command.type === 'SaveTask' ? {key:`task:${command.task.id}`,path:'task.id'}
        : command.type === 'SaveEvent' ? {key:`event:${command.event.id}`,path:'event.id'}
          : command.type === 'DeleteEvent' ? {key:`cleanup:${command.eventId}`,path:'eventId'} : undefined;
      if (entity) {
        requireWorld(!entities.has(entity.key), 'invalid_output', 'command_structure', entity.path);
        entities.add(entity.key);
      }
      const effect = fingerprint({...command,commandId:''});
      requireWorld(!effects.has(effect), 'invalid_output', 'command_structure');
      effects.add(effect);
      if (command.type === 'SaveTask' && !Object.hasOwn(base.tasks, command.task.id)) {
        const payload = fingerprint({...command.task,id:''});
        requireWorld(!newTaskPayloads.has(payload), 'invalid_output', 'task_duplicate', 'task.goal');
        newTaskPayloads.add(payload);
      }
    } catch (error) {
      throw worldValidationError(error, scope(command));
    }
  }
  // A terminal record already in the formal save may be quoted verbatim. Never
  // drop a real write, an open interaction, or this turn's newly projected state.
  const source = { ...result };
  const eventNotes: string[] = [];
  result.eventCommands = result.eventCommands.filter(command => {
    if (command.type !== 'SaveEvent' || !Object.hasOwn(original.events,command.event.id)) return true;
    const saved = original.events[command.event.id];
    if (!terminalEvent(saved) || ['pending','presented'].includes(saved.protagonistEntry?.status ?? '')) return true;
    const exact = fingerprint(saved);
    if (exact !== fingerprint(base.events[saved.id]) || exact !== fingerprint(command.event)) return true;
    eventNotes.push(`${scope(command).fieldPath}（SaveEvent）与已正式结案的事件完全相同，未重复写入。`);
    return false;
  });
  const commands = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
  const stageHandoffs=normalizeStageEntryHandoffs(result,base,draft,source);
  const taskNotes: string[] = [];
  const createdNpcs = new Map(result.worldCommands.flatMap(c => c.type === 'CreateNpc' ? [[c.npc.id, c.npc] as const] : []));
  const createdOrgs = new Map(result.worldCommands.flatMap(c => c.type === 'CreateOrganization' ? [[c.organization.id, c.organization] as const] : []));
  const actorAllowed = (ref: ActorRef) =>
    (ref.kind === 'npc' ? worldNpcAllowed(base, draft, ref.id, original) : offscreen(base, ref))
    || (ref.kind === 'npc' && createdNpcs.has(ref.id) && !createdNpcs.get(ref.id)?.onScene)
    || (ref.kind === 'organization' && createdOrgs.has(ref.id));
  const causal = structuredClone(base);
  // Only structured ID dependencies are ordered. Evidence is a non-executing explanation.
  for (const command of orderWorldCommands(commands)) {
    try {
      switch (command.type) {
        case 'UpdateNpc': {
          // 身份、关系、互动与重新入场字段不属于 World；冲突剔除不会处理这些字段，越权仍在此拒绝。
          const forbidden = Object.entries(command.changes).find(([key, value]) => worldForbiddenNpcChange(key, value));
          requireWorld(!forbidden, 'permission','actor_permission', forbidden && `changes.${forbidden[0]}`);
          requireWorld(causal.npc[command.npcId] && actorAllowed({kind:'npc', id:command.npcId}), 'permission','actor_permission','npcId');
          requireWorld(!command.affinityChange, 'permission','actor_permission','affinityChange');
          // Validate original permissions even if every scene field will later be stripped.
          break;
        }
        case 'RecordNpcMemory': {
          requireWorld(causal.npc[command.npcId] && actorAllowed({kind:'npc', id:command.npcId}), 'permission','actor_permission','npcId');
          requireWorld(Date.parse(command.memory.createdAtGameTime) >= Date.parse(state.worldClock)
            && Date.parse(command.memory.createdAtGameTime) <= now, 'invalid_output', 'memory_time_window', 'memory.createdAtGameTime');
          break;
        }
        case 'CreateNpc': {
          const npc = command.npc;
          const invalidField = [
            ['addressing',npc.addressing], ['onScene',npc.onScene], ['lastInteractionAt',npc.lastInteractionAt],
            ['affinity',npc.affinity !== 0], ['affinityConfirmed',npc.affinityConfirmed],
            ['memories',npc.memories.length], ['knownInformation',npc.knownInformation.length],
            ['longTermMemories',npc.kind === 'special' && npc.longTermMemories?.length],
          ].find(([,invalid]) => invalid)?.[0];
          requireWorld(!invalidField,'permission','actor_permission',invalidField ? `npc.${invalidField}` : undefined);
          break;
        }
        case 'CreateOrganization': {
          const org = command.organization;
          requireWorld(!org.relationHistory.length && !org.protagonistKnown?.length, 'permission', 'organization_initialization');
          requireWorld(!Object.values(base.organizations).some(known => known.kind === org.kind && known.name === org.name),
            'invalid_output','entity_id','organization.name');
          requireWorld((org.kind !== 'gang' || org.funds === undefined)
            && (org.kind !== 'business' || (org.assetsEstimate === undefined && org.liquidityEstimate === undefined)),
            'permission','actor_permission','organization');
          break;
        }
        case 'UpdateOrganization': {
          requireWorld(causal.organizations[command.organizationId], 'permission','actor_permission','organizationId');
          // Duplicate scene fields are stripped only after the original candidate is valid.
          break;
        }
        case 'RecordOrgRelation':
          requireWorld(causal.organizations[command.organizationId], 'permission','actor_permission','organizationId');
          // 主势力绑定是主角身份，只能由Variables依剧情写入。
          requireWorld(!command.faction, 'permission','actor_permission','faction');
          // A duplicate relationship may be ignored only after validating its target.
          break;
        case 'CreateLocation': break; // Domain validation enforces hierarchy and references.
        case 'SaveTask': {
          const task = command.task, old = base.tasks[task.id], formal = state.tasks[task.id];
          requireWorld(!formal || sameActor(formal.actorRef, task.actorRef), 'permission','actor_permission','task.actorRef');
          requireWorld(actorAllowed(task.actorRef) && (!old || sameActor(old.actorRef, task.actorRef)), 'permission', 'actor_permission', 'task.actorRef');
          if (task.handoff && !old) {
            const transfer = task.handoff, prior = causal.tasks[transfer.fromTaskId];
            requireWorld(prior?.resolution && ['completed','cancelled'].includes(prior.status), 'invalid_output', 'task_state','task.handoff.fromTaskId');
            requireWorld(actorAllowed(prior.actorRef), 'permission','actor_permission','task.handoff.fromTaskId');
            requireWorld(Date.parse(transfer.at) >= Date.parse(state.worldClock)
              && Date.parse(prior.resolution.at) <= Date.parse(transfer.at)
              && Date.parse(transfer.at) <= Date.parse(task.startAt) && Date.parse(transfer.at) <= now, 'invalid_output', 'event_time','task.handoff.at');
          }
          if (old) {
            // 只差空白、全半角或时间写法时沿用存档原值；内容确有改写仍拒绝（#193）。
            const identityNote = keepTaskIdentity(old, task);
            if (identityNote) taskNotes.push(identityNote);
            if (['completed','cancelled'].includes(old.status) && fingerprint(old) !== fingerprint(task))
              requireWorld(false, 'invalid_output', 'task_state',changedRecordField('task',old,task));
            if (['active','blocked'].includes(old.status)) requireWorld(task.status !== 'planned', 'invalid_output', 'task_state', 'task.status');
          } else requireWorld(!Object.values(base.tasks).some(known => sameActor(known.actorRef,task.actorRef)
            && sameTaskText(known.goal, task.goal) && sameTaskInstant(known.startAt, task.startAt)), 'invalid_output', 'task_duplicate', 'task.goal');
          if (['active','blocked','completed'].includes(task.status)) requireWorld(Date.parse(task.startAt) <= now, 'invalid_output','task_state', 'task.startAt');
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
          if(event.eventKind==='sub' && old && terminalEvent(old))
            requireWorld(false,'invalid_output','event_transition',changedRecordField('event',old,event));
          if(event.eventKind==='sub' && (!old || !terminalEvent(old))) {
            if(old && !terminalEvent(event) && fingerprint(old)!==fingerprint(event))
              requireWorld(false,'permission','event_transition',changedRecordField('event',old,event));
            if(terminalEvent(event)) requireWorld(Date.parse(event.resolvedAt!)===Date.parse(event.fixedEndAt!), 'invalid_output','event_time','event.resolvedAt');
          }
          if (!old || !terminalEvent(event)) {
            const checked = plannedEventSchema(event).safeParse(event);
            if (!checked.success) throw worldValidationError(checked.error,{fieldPath:'event',worldRule:'event_plan'});
          }
          requireWorld(!event.estimatedEndAt || Date.parse(event.estimatedEndAt) >= Date.parse(event.startAt), 'invalid_output','event_time', 'event.estimatedEndAt');
          if (!terminalEvent(event)) for (const field of ['resolvedAt','resolutionText','resultKnowledge'] as const)
            requireWorld(event[field] === undefined, 'invalid_output','event_transition',`event.${field}`);
          if (event.resolvedAt) requireWorld(Date.parse(event.resolvedAt) <= now, 'invalid_output','event_time', 'event.resolvedAt');
          // Event participants record identities; they do not execute movements, payments or player decisions.
          event.actorRefs.forEach((ref, index) => requireWorld(ref.kind === 'protagonist' ? ref.id === base.protagonist.id
            : ref.kind === 'organization' ? Boolean(causal.organizations[ref.id])
              : Boolean(causal.npc[ref.id]), 'permission', 'actor_permission', `event.actorRefs.${index}`));
          requireWorld(old ? old.entryIntent === event.entryIntent : !event.entryIntent || event.continuation?.direction === 'protagonist',
            'invalid_output','event_immutable','event.entryIntent');
          if (old) {
            requireWorld(old.startAt === event.startAt
              && old.completionCondition === event.completionCondition, 'invalid_output', 'event_immutable', old.startAt !== event.startAt ? 'event.startAt' : 'event.completionCondition');
            if (terminalEvent(old) && fingerprint(old) !== fingerprint(event))
              requireWorld(false, 'invalid_output','event_transition',changedRecordField('event',old,event));
            if (['active','blocked'].includes(old.status)) requireWorld(event.status !== 'scheduled', 'invalid_output','event_transition', 'event.status');
          } else requireWorld(!Object.values(base.events).some(known => known.title === event.title
            && known.startAt === event.startAt && fingerprint(known.actorRefs) === fingerprint(event.actorRefs)),
          'invalid_output','entity_id','event.id');
          for (const [index,id] of (event.predecessorEventIds ?? []).entries()) {
            const prior = historicalEvent(causal,id);
            const path = `event.predecessorEventIds.${index}`;
            requireWorld(prior,'invalid_output','event_reference',path);
            requireWorld(terminalEvent(prior) && prior.resolvedAt
              && Date.parse(prior.resolvedAt) <= Date.parse(event.startAt), 'invalid_output','event_transition',path);
          }
          const knownTurns = new Set([draft.turnId, ...state.journal.map(entry => entry.turnId)]);
          requireWorld(event.sourceTurnIds.includes(draft.turnId) && event.sourceTurnIds.every(id => knownTurns.has(id))
            && (old?.sourceTurnIds ?? []).every(id => event.sourceTurnIds.includes(id)), 'invalid_output', 'event_sources', 'event.sourceTurnIds');
          if (['active','blocked','resolved'].includes(event.status)) requireWorld(Date.parse(event.startAt) <= now, 'invalid_output','event_time','event.startAt');
          if (event.status === 'resolved') requireWorld(event.resolvedAt && event.resolutionText?.trim(),
            'invalid_output','event_transition',event.resolvedAt ? 'event.resolutionText' : 'event.resolvedAt');
          // Objective progress never implicitly refreshes an already held character snapshot.
          if (!old || !terminalEvent(old)) {
            const prior = old && protagonistKnownEvent(old);
            const snapshot = prior ? {worldUpdateTurnId:draft.turnId,title:prior.title,startAt:prior.startAt,status:prior.status,
              ...(prior.resolutionText === undefined ? {} : {resolutionText:prior.resolutionText}),
              ...('notice' in prior ? {notice:prior.notice,knowledgeKind:prior.knowledgeKind} : {})} : undefined;
            requireWorld(!event.protagonistKnowledge || fingerprint(event.protagonistKnowledge) === fingerprint(old?.protagonistKnowledge)
              || fingerprint(event.protagonistKnowledge) === fingerprint(snapshot), 'permission','actor_permission','event.protagonistKnowledge');
            if (snapshot) {
              event.protagonistKnowledge = snapshot;
              event.sourceTurnIds = [...event.sourceTurnIds.filter(id => id !== draft.turnId),draft.turnId];
            } else delete event.protagonistKnowledge;
          }
          if(!stageHandoffs.has(event.id)) normalizeEventContinuation(event,old,base,draft,causal.locations);
          break;
        }
        case 'RecordHistory': break; // 只记录，不广播知识；引用/日期/ID由同一领域投影验证。
        case 'ApplyHaremBackground': {
          // 场外推进：只碰离场成员；Variables 本回合已写的同一计划、成员对或总体局势不得覆盖。
          const variableEdits = (draft.entities?.result.commands ?? [])
            .flatMap(c => c.type === 'ApplyHaremChanges' ? c.changes : []);
          const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
          for (const [index, edit] of command.changes.entries()) {
            if (edit.op === 'plan') {
              requireWorld(worldNpcAllowed(base, draft, edit.npcId, original), 'permission','actor_permission', `changes.${index}.npcId`);
              requireWorld(!variableEdits.some(v => v.op === 'plan' && v.npcId === edit.npcId), 'permission','actor_permission', `changes.${index}.npcId`);
            } else if (edit.op === 'pair') {
              requireWorld(worldNpcAllowed(base, draft, edit.value.leftNpcId, original) && worldNpcAllowed(base, draft, edit.value.rightNpcId, original),
                'permission','actor_permission', `changes.${index}.value`);
              const key = pairKey(edit.value.leftNpcId, edit.value.rightNpcId);
              requireWorld(!variableEdits.some(v => v.op === 'pair' && pairKey(v.value.leftNpcId, v.value.rightNpcId) === key),
                'permission','actor_permission', `changes.${index}.value`);
            } else requireWorld(!variableEdits.some(v => v.op === 'overview'), 'permission','actor_permission', `changes.${index}`);
          }
          break;
        }
        case 'DeleteEvent': {
          const event = historicalEvent(causal,command.eventId);
          requireWorld(event && terminalEvent(event), 'invalid_output','event_transition','eventId');
          requireWorld(causal.events[command.eventId]?.status === command.expectedStatus,
            'invalid_output','event_transition','expectedStatus');
          break;
        }
        default: requireWorld(false,'permission');
      }
      if (command.type === 'CreateNpc') causal.npc[command.npc.id] = NpcSchema.parse(command.npc.kind === 'special'
        ? { ...command.npc, longTermMemories: command.npc.longTermMemories ?? [] } : command.npc);
      if (command.type === 'CreateOrganization') causal.organizations[command.organization.id] = command.organization;
      if (command.type === 'CreateLocation') causal.locations[command.location.id] = command.location;
      if (command.type === 'SaveTask') causal.tasks[command.task.id] = command.task;
      if (command.type === 'SaveEvent') causal.events[command.event.id] = command.event;
    } catch (error) { throw worldValidationError(error,scope(command)); }
  }
  let projected: GameState;
  try { projected = projectTurn(original, draft, commands); }
  catch (error) { throw worldProjectionError(error, result, original, draft, source); }
  // The domain projection before scene-write stripping must also pass: stripping must not hide stale
  // revisions, invalid references or other domain constraints in discarded values.
  const sceneWriteNotes = stripVariableSceneWrites(result, state, draft);
  if (sceneWriteNotes.length) {
    const retained = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
    // Normalization may make distinct raw writes identical; preserve the same
    // duplicate-effect boundary when Commit revalidates this normalized result.
    const retainedEffects = new Set<string>();
    for (const command of retained) {
      const effect = fingerprint({ ...command, commandId: '' });
      try { requireWorld(!retainedEffects.has(effect),'invalid_output','command_structure'); }
      catch (error) { throw worldValidationError(error,scope(command)); }
      retainedEffects.add(effect);
    }
    try { projected = projectTurn(original, draft, retained); }
    catch (error) { throw worldProjectionError(error, result, original, draft, source); }
  }
  if ((!draft.useVariableStage || draft.variables?.validation === 'validated') && !historicalPerspective(state,draft)) {
    const deferredStages = allowDeferred ? deferredStageIds(base, projected) : [];
    const deferred = [...deferredStages];
    for (const due of worldEventSchedule(state,base).due.filter(event => event.eventKind !== 'sub')) {
      const after = projected.events[due.eventId] ?? projected.retiredEvents[due.eventId];
      if (allowDeferred && fingerprint(after) === fingerprint(base.events[due.eventId])) {
        deferred.push(due.eventId);
        continue;
      }
      requireWorld(after && (terminalEvent(after)
        || ('estimatedEndAt' in after && after.estimatedEndAt && Date.parse(after.estimatedEndAt) > now)
        || ('protagonistEntry' in after && ['pending','presented'].includes(after.protagonistEntry?.status ?? ''))),
      'invalid_output', 'due_event_unhandled');
    }
    validateStageSettlement(base, projected, draft.turnId, deferredStages);
    if (deferred.length) result.deferredEvents = deferred.sort();
  }
  for(const command of result.eventCommands) if(command.type==='SaveEvent' && !terminalEvent(command.event) && command.event.eventKind!=='main') {
    // V2 sub-events carry a fixed bound, never an estimated scheduling alias.
    // Sub-event dispatch uses fixedEndAt; untyped legacy events retain estimatedEndAt.
    const end=command.event.eventKind==='sub' ? command.event.fixedEndAt : command.event.estimatedEndAt;
    try {
      requireWorld(['pending','presented'].includes(command.event.protagonistEntry?.status??'') || (end && Date.parse(end)>Date.parse(base.worldClock)),
        'invalid_output','event_time',command.event.eventKind==='sub' ? 'event.fixedEndAt' : 'event.estimatedEndAt');
    } catch (error) { throw worldValidationError(error,scope(command)); }
  }
  for(const command of result.eventCommands) if(command.type==='SaveEvent' && command.event.eventKind==='sub'
    && terminalEvent(command.event) && command.event.continuation?.direction==='protagonist')
    requireWorld(result.eventCommands.some(c=>c.type==='SaveEvent' && !c.event.eventKind && !terminalEvent(c.event)
      && c.event.predecessorEventIds?.includes(command.event.id) && c.event.continuation?.direction==='protagonist'), 'invalid_output','event_continuation');
  // Legacy continuations need a live successor; fixed stages can finish a chain in one window.
  for(const command of result.eventCommands) if(command.type==='SaveEvent' && terminalEvent(command.event) && command.event.continuation?.direction==='world') {
    const successors=result.eventCommands.filter(c=>c.type==='SaveEvent' && c.event.predecessorEventIds?.includes(command.event.id));
    requireWorld(successors.length>0 && (command.event.eventKind==='sub' || successors.every(c=>c.type==='SaveEvent' && !terminalEvent(c.event))), 'invalid_output','event_continuation');
  }
  const notes = [...taskNotes, ...eventNotes, ...sceneWriteNotes];
  if (notes.length) worldNormalizationNotes.set(result, notes);
  return result;
}
