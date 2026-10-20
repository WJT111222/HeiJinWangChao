import { fingerprint } from '../../domain/commands';
import type { ActorRef } from '../../domain/common';
import { WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { worldTypes } from './commandCatalog';
import { readWorldEvidence, requireWorld, worldSources, speculative } from './worldEvidence';
import { isNegatedFact } from '../../domain/factPolarity';
import type { WorldEvidence, WorldSource } from './worldEvidence';
import type { DomainCommand } from '../../domain/commands';

function sameActor(a: ActorRef, b: ActorRef) {
  return a.kind === b.kind && a.id === b.id;
}
function offscreen(state: GameState, ref: ActorRef) {
  return ref.kind === 'npc'
    ? Boolean(state.npc[ref.id] && !state.npc[ref.id].onScene)
    : ref.kind === 'organization' && Boolean(state.organizations[ref.id]);
}
function readyConditions(state: GameState, conditions: readonly string[]) {
  return conditions.every((ref) => {
    const task =
      state.tasks[ref] ?? (ref.startsWith('task:') ? state.tasks[ref.slice(5)] : undefined);
    const event =
      state.events[ref] ?? (ref.startsWith('event:') ? state.events[ref.slice(6)] : undefined);
    return task?.status === 'completed' || event?.status === 'resolved';
  });
}
function npcTaskOccupancy(state: GameState, base: GameState, commands: readonly DomainCommand[]) {
  const occupied = new Map<string, Set<string>>();
  const occupy = (npcId: string, taskId: string) => {
    const tasks = occupied.get(npcId) ?? new Set<string>();
    tasks.add(taskId);
    occupied.set(npcId, tasks);
    return tasks;
  };
  // 正式状态和变量投影都算占用；本批完成/取消不立即释放，避免同批接力。
  for (const task of [...Object.values(state.tasks), ...Object.values(base.tasks)])
    if (task.actorRef.kind === 'npc' && !['completed', 'cancelled'].includes(task.status))
      occupy(task.actorRef.id, task.id);
  const existingConflicts = [...occupied].filter(([, tasks]) => tasks.size > 1);
  // 同批新建并终结的临时任务也不能被用作“先完成 A 再接 B”的绕行路径。
  for (const command of commands)
    if (
      command.type === 'SaveTask' &&
      command.task.actorRef.kind === 'npc' &&
      !base.tasks[command.task.id] &&
      ['completed', 'cancelled'].includes(command.task.status)
    )
      occupy(command.task.actorRef.id, command.task.id);
  for (const command of commands) {
    if (command.type !== 'SaveTask') continue;
    const task = command.task;
    if (task.actorRef.kind !== 'npc' || ['completed', 'cancelled'].includes(task.status)) continue;
    requireWorld(occupy(task.actorRef.id, task.id).size === 1, 'npc_task_conflict');
  }
  // 旧数据保留原样；即便本轮没有新增任务，也在内部 unresolved 明确报告。
  return existingConflicts.map(
    ([id, tasks]) =>
      `已有 NPC ${id} 的未终结任务冲突：${[...tasks].sort().join('、')}。未自动删除或改派任务；本轮不得新增占用。`,
  );
}
function outcome(
  proof: WorldEvidence,
  sources: readonly WorldSource[],
  key: string,
  start: string,
  to: string,
  existing: boolean,
) {
  requireWorld(proof.kind === 'established' || proof.kind === 'derived');
  requireWorld(Date.parse(start) <= Date.parse(proof.at) && Date.parse(proof.at) <= Date.parse(to));
  requireWorld(!existing || sources.some((source) => source.id === key));
  if (proof.kind === 'derived') {
    requireWorld(
      Date.parse(proof.at) > Date.parse(start) &&
        proof.outcome &&
        proof.outcome !== proof.fact &&
        !/^(?:(?:任务|事件|行动|工作|时间)(?:已经|已)?|已经|已)?(?:到期|到(?:了)?|完成|结束|成功|失败)(?:了)?[。！!]?$/u.test(
          proof.outcome,
        ),
    );
    requireWorld(!speculative.test(proof.outcome) && !isNegatedFact(proof.outcome));
  }
}
export function validateWorldOutput(raw: unknown, state: GameState, draft: TurnDraft) {
  const checked = WorldResultSchema.safeParse(raw);
  requireWorld(checked.success && draft.story);
  const result = checked.data,
    base = projectTurn(state, draft);
  const sources = worldSources(base, draft, state);
  const commands = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];
  const taskConflicts = npcTaskOccupancy(state, base, commands);
  const allowed = new Set<string>(worldTypes);
  for (const command of result.worldCommands) requireWorld(allowed.has(command.type), 'permission');
  for (const command of result.taskCommands)
    requireWorld(command.type === 'SaveTask', 'permission');
  for (const command of result.eventCommands)
    requireWorld(command.type === 'SaveEvent', 'permission');
  const variableIds =
    draft.variables?.validation === 'validated'
      ? draft.variables.result.commands.map((c) => c.commandId)
      : [];
  const ids = [...variableIds, ...commands.map((command) => command.commandId)];
  requireWorld(new Set(ids).size === ids.length);
  const facts = commands.map((command) => fingerprint({ ...command, commandId: '' }));
  requireWorld(new Set(facts).size === facts.length);
  // 同一批次每个任务/事件只接受一个完整对象，避免通过先改行动者再更新绕过权限。
  const entityKeys = commands.flatMap((c) =>
    c.type === 'SaveTask'
      ? [`task:${c.task.id}`]
      : c.type === 'SaveEvent'
        ? [`event:${c.event.id}`]
        : [],
  );
  requireWorld(new Set(entityKeys).size === entityKeys.length);
  const createdNpcs = new Map(
    result.worldCommands.flatMap((c) =>
      c.type === 'CreateNpc' ? [[c.npc.id, c.npc] as const] : [],
    ),
  );
  const createdOrgs = new Map(
    result.worldCommands.flatMap((c) =>
      c.type === 'CreateOrganization' ? [[c.organization.id, c.organization] as const] : [],
    ),
  );
  const actorAllowed = (ref: ActorRef) =>
    (offscreen(base, ref) &&
      !(
        ref.kind === 'npc' &&
        (state.npc[ref.id]?.onScene ||
          (draft.turnKind === 'opening' && ref.id === base.initialCompanionId))
      )) ||
    (ref.kind === 'npc' && createdNpcs.has(ref.id) && !createdNpcs.get(ref.id)?.onScene) ||
    (ref.kind === 'organization' && createdOrgs.has(ref.id));
  const newActor = (ref: ActorRef) =>
    ref.kind === 'npc'
      ? createdNpcs.has(ref.id)
      : ref.kind === 'organization' && createdOrgs.has(ref.id);
  for (const command of commands) {
    const { proof, sources: origins } = readWorldEvidence(
      command,
      sources,
      state.worldClock,
      base.worldClock,
    );
    const tiedTo = (ref: ActorRef) =>
      origins.some(
        (source) =>
          source.actors.some((actor) => sameActor(actor, ref)) ||
          (source.id === 'story:current' &&
            proof.kind === 'established' &&
            [
              ref.id,
              ref.kind === 'npc'
                ? (base.npc[ref.id] ?? createdNpcs.get(ref.id))?.name
                : ref.kind === 'organization'
                  ? (base.organizations[ref.id] ?? createdOrgs.get(ref.id))?.name
                  : base.protagonist.name,
            ].some((name) => name && proof.fact.includes(name))),
      );
    if (proof.kind === 'derived') {
      // 不能借“依据已有任务”绕过其关键阻碍，再只写人物结果而不写任务状态。
      for (const source of origins) {
        const task = source.id.startsWith('task:') ? base.tasks[source.id.slice(5)] : undefined;
        const event = source.id.startsWith('event:') ? base.events[source.id.slice(6)] : undefined;
        const work = task ?? event;
        const cancelling =
          (command.type === 'SaveTask' &&
            command.task.status === 'cancelled' &&
            task?.id === command.task.id) ||
          (command.type === 'SaveEvent' &&
            command.event.status === 'cancelled' &&
            event?.id === command.event.id);
        if (work && !cancelling)
          requireWorld(
            work.status !== 'cancelled' &&
              Date.parse(work.startAt) <= Date.parse(proof.at) &&
              readyConditions(base, [...work.prerequisites, ...work.blockers]),
          );
      }
    }
    const ownPrivateSources = (ref: ActorRef) =>
      origins.every(
        (source) =>
          source.ownerNpcId === undefined || (ref.kind === 'npc' && source.ownerNpcId === ref.id),
      );
    switch (command.type) {
      case 'UpdateNpc': {
        const person = base.npc[command.npcId];
        requireWorld(person && actorAllowed({ kind: 'npc', id: person.id }), 'permission');
        requireWorld(
          draft.turnKind !== 'opening' || person.id !== base.initialCompanionId,
          'permission',
        );
        requireWorld(
          !command.affinityChange &&
            command.changes.relationshipText === undefined &&
            command.changes.lastInteractionAt === undefined &&
            command.changes.onScene !== true,
          'permission',
        );
        requireWorld(tiedTo({ kind: 'npc', id: person.id }), 'permission');
        requireWorld(ownPrivateSources({ kind: 'npc', id: person.id }), 'permission');
        if (proof.kind === 'planned')
          requireWorld(
            Object.keys(command.changes).length === 0 && command.activeGoals !== undefined,
            'permission',
          );
        else requireWorld(proof.kind === 'derived' || proof.kind === 'established');
        if (command.changes.locationId !== undefined || command.changes.healthText !== undefined) {
          requireWorld(
            proof.kind !== 'derived' || Date.parse(proof.at) > Date.parse(state.worldClock),
          );
          requireWorld(
            command.npcId !== base.initialCompanionId || draft.turnKind !== 'opening',
            'permission',
          );
        }
        break;
      }
      case 'RecordNpcMemory': {
        const person = base.npc[command.npcId];
        requireWorld(person && actorAllowed({ kind: 'npc', id: person.id }), 'permission');
        requireWorld(
          draft.turnKind !== 'opening' || person.id !== base.initialCompanionId,
          'permission',
        );
        requireWorld(
          origins.every(
            (source) =>
              source.ownerNpcId === person.id ||
              (source.ownerNpcId === undefined &&
                source.actors.some((actor) => actor.kind === 'npc' && actor.id === person.id)),
          ),
          'permission',
        );
        requireWorld(
          proof.kind !== 'planned' &&
            (command.knowledgeKind === 'observed'
              ? proof.kind === 'established' || proof.kind === 'derived'
              : proof.kind === command.knowledgeKind),
        );
        requireWorld(Date.parse(command.memory.createdAtGameTime) === Date.parse(proof.at));
        requireWorld(proof.sources.some((id) => command.memory.knowledgeSource.includes(id)));
        requireWorld(
          command.memory.text === proof.fact ||
            command.memory.text ===
              `${command.knowledgeKind === 'reported' ? '[转述]' : '[推测]'}${proof.fact}`,
        );
        if (command.memory.visibility === 'player_known')
          requireWorld(proof.kind === 'established', 'permission');
        break;
      }
      case 'CreateNpc': {
        const npc = command.npc;
        requireWorld(
          !npc.onScene &&
            !npc.lastInteractionAt &&
            npc.affinity === 0 &&
            !npc.affinityConfirmed &&
            !npc.memories.length &&
            !npc.knownInformation.length &&
            npc.relationshipText === '尚未与主角接触' &&
            (npc.kind !== 'special' || !npc.longTermMemories.length),
          'permission',
        );
        requireWorld(proof.kind === 'established' || proof.kind === 'derived');
        break;
      }
      case 'CreateOrganization': {
        const org = command.organization;
        requireWorld(
          org.protagonistRelation === '尚未与主角接触' && !org.relationHistory.length,
          'permission',
        );
        requireWorld(
          !Object.values(base.organizations).some(
            (known) => known.kind === org.kind && known.name === org.name,
          ),
        );
        requireWorld(proof.kind === 'established' || proof.kind === 'derived');
        requireWorld(
          (org.kind !== 'gang' || org.funds === undefined) &&
            (org.kind !== 'business' ||
              (org.assetsEstimate === undefined && org.liquidityEstimate === undefined)),
          'permission',
        );
        break;
      }
      case 'RecordOrgRelation':
        requireWorld(
          base.organizations[command.organizationId] &&
            proof.kind === 'established' &&
            tiedTo({ kind: 'organization', id: command.organizationId }),
          'permission',
        );
        requireWorld(proof.fact.includes(command.reason) && proof.fact.includes(command.relation));
        requireWorld(
          ownPrivateSources({ kind: 'organization', id: command.organizationId }),
          'permission',
        );
        break;
      case 'CreateLocation':
        requireWorld(proof.kind === 'established' || proof.kind === 'derived');
        break;
      case 'SaveTask': {
        const task = command.task,
          old = base.tasks[task.id];
        const formal = state.tasks[task.id];
        requireWorld(!formal || sameActor(formal.actorRef, task.actorRef), 'permission');
        requireWorld(
          actorAllowed(task.actorRef) &&
            (!old || (actorAllowed(old.actorRef) && sameActor(old.actorRef, task.actorRef))),
          'permission',
        );
        requireWorld(tiedTo(task.actorRef) || (!old && newActor(task.actorRef)), 'permission');
        requireWorld(ownPrivateSources(task.actorRef), 'permission');
        if (old) {
          requireWorld(
            old.goal === task.goal &&
              old.startAt === task.startAt &&
              old.completionCondition === task.completionCondition,
          );
          if (['completed', 'cancelled'].includes(old.status))
            requireWorld(fingerprint(old) === fingerprint(task));
          if (old.status === 'active' || old.status === 'blocked')
            requireWorld(task.status !== 'planned');
        } else
          requireWorld(
            !Object.values(base.tasks).some(
              (known) =>
                sameActor(known.actorRef, task.actorRef) &&
                known.goal === task.goal &&
                known.startAt === task.startAt,
            ),
          );
        if (!old && proof.kind !== 'established')
          requireWorld(Date.parse(task.startAt) >= Date.parse(state.worldClock));
        if (task.status === 'planned')
          requireWorld(proof.kind === 'planned' || proof.kind === 'established');
        if (task.status === 'blocked')
          requireWorld(
            proof.kind !== 'planned' && Date.parse(task.startAt) <= Date.parse(proof.at),
          );
        if (task.status === 'active' || task.status === 'completed') {
          requireWorld(
            proof.kind !== 'planned' && Date.parse(task.startAt) <= Date.parse(proof.at),
          );
          requireWorld(
            readyConditions(base, [
              ...(old?.prerequisites ?? []),
              ...(old?.blockers ?? []),
              ...task.prerequisites,
              ...task.blockers,
            ]),
          );
        }
        if (task.status === 'completed')
          outcome(proof, origins, `task:${task.id}`, task.startAt, base.worldClock, Boolean(old));
        if (task.status === 'cancelled') requireWorld(old && proof.kind !== 'planned');
        break;
      }
      case 'SaveEvent': {
        const event = command.event,
          old = base.events[event.id];
        // 预计时间是可调整的估计，非终态不能预存实际结案字段（空串也不接受）。
        if (['scheduled', 'active', 'blocked'].includes(event.status))
          requireWorld(event.resolvedAt === undefined && event.resolutionText === undefined);
        // cancelled 可沿用既有的取消说明/实际终止时间；不强迫其使用 resolved 的字段组合。
        if (event.status === 'cancelled' && event.resolvedAt !== undefined)
          requireWorld(Date.parse(event.resolvedAt) <= Date.parse(proof.at));
        if (!old) {
          requireWorld(
            !Object.values(base.events).some(
              (known) =>
                known.title === event.title &&
                known.startAt === event.startAt &&
                fingerprint(known.actorRefs) === fingerprint(event.actorRefs),
            ),
          );
          if (proof.kind !== 'established')
            requireWorld(Date.parse(event.startAt) >= Date.parse(state.worldClock));
        }
        requireWorld(
          !event.actorRefs.length
            ? proof.kind === 'established'
            : event.actorRefs.some((ref) => tiedTo(ref) || (!old && newActor(ref))),
          'permission',
        );
        requireWorld(
          event.actorRefs.every((ref) =>
            ref.kind === 'protagonist' ? ref.id === base.protagonist.id : actorAllowed(ref),
          ),
          'permission',
        );
        if (
          event.actorRefs.some((ref) => ref.kind === 'protagonist') &&
          ['active', 'resolved'].includes(event.status)
        )
          requireWorld(proof.kind === 'established', 'permission');
        if (old) {
          requireWorld(
            old.actorRefs.every((ref) => ref.kind === 'protagonist' || actorAllowed(ref)),
            'permission',
          );
          requireWorld(
            fingerprint(old.actorRefs) === fingerprint(event.actorRefs) &&
              old.startAt === event.startAt,
          );
          requireWorld(old.completionCondition === event.completionCondition);
          if (['resolved', 'cancelled'].includes(old.status))
            requireWorld(fingerprint(old) === fingerprint(event));
          if (old.status === 'active' || old.status === 'blocked')
            requireWorld(event.status !== 'scheduled');
        }
        const knownTurns = new Set([draft.turnId, ...state.journal.map((entry) => entry.turnId)]);
        requireWorld(
          event.sourceTurnIds.includes(draft.turnId) &&
            event.sourceTurnIds.every((id) => knownTurns.has(id)) &&
            (old?.sourceTurnIds ?? []).every((id) => event.sourceTurnIds.includes(id)),
        );
        if (event.status === 'scheduled')
          requireWorld(proof.kind === 'planned' || proof.kind === 'established');
        if (event.status === 'blocked')
          requireWorld(
            proof.kind !== 'planned' && Date.parse(event.startAt) <= Date.parse(proof.at),
          );
        if (event.status === 'active' || event.status === 'resolved') {
          requireWorld(
            proof.kind !== 'planned' && Date.parse(event.startAt) <= Date.parse(proof.at),
          );
          requireWorld(
            readyConditions(base, [
              ...(old?.prerequisites ?? []),
              ...(old?.blockers ?? []),
              ...event.prerequisites,
              ...event.blockers,
            ]),
          );
        }
        if (event.status === 'resolved') {
          outcome(
            proof,
            origins,
            `event:${event.id}`,
            event.startAt,
            base.worldClock,
            Boolean(old),
          );
          requireWorld(event.resolutionText?.trim());
          requireWorld(event.resolvedAt && Date.parse(event.resolvedAt) === Date.parse(proof.at));
        }
        if (event.status === 'cancelled') requireWorld(old && proof.kind !== 'planned');
        // 候选不发布消息；模型也不能通过改 visibility 伪造主角已知。
        if (event.visibility !== 'hidden' && event.visibility !== old?.visibility)
          requireWorld(proof.kind === 'established', 'permission');
        break;
      }
      default:
        requireWorld(false, 'permission');
    }
  }
  // futureEvents 是已验证未来 SaveEvent 的镜像，不是第二条免证据写入路径。
  requireWorld(
    new Set(result.futureEvents.map((event) => event.id)).size === result.futureEvents.length,
  );
  for (const event of result.futureEvents) {
    const command = result.eventCommands.find(
      (c) => c.type === 'SaveEvent' && c.event.id === event.id,
    );
    requireWorld(
      !base.events[event.id] &&
        event.status === 'scheduled' &&
        Date.parse(event.startAt) >= Date.parse(base.worldClock) &&
        command?.type === 'SaveEvent' &&
        fingerprint(command.event) === fingerprint(event),
    );
  }
  const projected = projectTurn(state, draft, commands);
  requireWorld(new Set(result.timelineCandidates).size === result.timelineCandidates.length);
  requireWorld(
    result.timelineCandidates.every(
      (id) =>
        projected.events[id]?.status === 'resolved' && projected.events[id]?.impact === 'major',
    ),
  );
  result.unresolved = [...new Set([...result.unresolved, ...taskConflicts])];
  return result;
}
