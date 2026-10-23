import { hasKnownPlayerConnection } from '../../domain/npc/contactReview';
import { DataError } from '../../domain/common';
import { orderWorldCommands } from './worldDependencies';
import { fingerprint } from '../../domain/commands';
import type { ActorRef } from '../../domain/common';
import { WorldResultSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { projectTurn } from '../../domain/turnProjection';
import { worldTypes } from './commandCatalog';
import {
  readWorldEvidence,
  requireWorld,
  worldSources,
  speculative,
  hasAffirmedTermination,
  hasPlayerKnownFact,
} from './worldEvidence';
import { isNegatedFact } from '../../domain/factPolarity';
import type { WorldEvidence, WorldSource } from './worldEvidence';

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
  if (proof.decision) {
    const decision = proof.decision;
    requireWorld(decision.targetId === key.slice(key.indexOf(':') + 1)
      && ['completed', 'resolved'].includes(decision.status) && decision.conditionsSatisfied && !decision.continues && !decision.failure
      && Date.parse(start) < Date.parse(proof.at));
    return;
  }
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
function cancellationEvidence(proof: WorldEvidence, sources: readonly WorldSource[], key: string) {
  requireWorld(proof.kind === 'established' || proof.kind === 'derived');
  requireWorld(sources.some((source) => source.id === key));
  if (proof.decision) {
    requireWorld(proof.decision.targetId === key.slice(key.indexOf(':') + 1)
      && proof.decision.status === 'cancelled' && !proof.decision.continues);
    return;
  }
  requireWorld(hasAffirmedTermination(proof.fact));
  if (proof.kind === 'derived') {
    requireWorld(proof.outcome && proof.outcome !== proof.fact && !speculative.test(proof.outcome));
    // 终止原因/实际后果必须另行交代；重复“任务已取消”不能作为自证结果。
    requireWorld(
      !/^(?:(?:该|此|本次)?(?:任务|事件|行动|工作|安排|排程))?(?:已经|现已|已|正式|最终)?(?:被)?(?:取消|撤销|终止|放弃|叫停|停止执行|停止|结束)(?:了)?[。！!]?$/u.test(
        proof.outcome.replace(/\s/g, ''),
      ),
    );
  }
}
export function validateWorldOutput(raw: unknown, state: GameState, draft: TurnDraft) {
  const checked = WorldResultSchema.safeParse(raw);
  requireWorld(checked.success && draft.story);
  const result = checked.data,
    base = projectTurn(state, draft);
  const sources = worldSources(base, draft, state);
  const commands = [...result.worldCommands, ...result.taskCommands, ...result.eventCommands];

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
  // 经过验证的前序任务/事件才可进入下一项的来源与条件投影。
  const causal = structuredClone(base);
  for (const command of orderWorldCommands(commands)) {
    const { proof, sources: origins } = readWorldEvidence(
      command,
      sources,
      state.worldClock,
      base.worldClock,
    );
    requireWorld(!proof.decision?.resultKnowledge || (command.type === 'SaveTask'
      && ['completed', 'cancelled'].includes(command.task.status)) || (command.type === 'SaveEvent'
      && ['resolved', 'cancelled'].includes(command.event.status)));
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
        const task = source.id.startsWith('task:') ? causal.tasks[source.id.slice(5)]
          : source.id.startsWith('task-plan:') ? causal.tasks[source.id.slice(10)]
            : source.id.startsWith('task-result:') ? causal.tasks[source.id.slice(12)] : undefined;
        const event = source.id.startsWith('event:') ? causal.events[source.id.slice(6)]
          : source.id.startsWith('event-plan:') ? causal.events[source.id.slice(11)]
            : source.id.startsWith('event-result:') ? causal.events[source.id.slice(13)] : undefined;
        const work = task ?? event;
        const cancelling =
          (command.type === 'SaveTask' &&
            command.task.status === 'cancelled' &&
            task?.id === command.task.id) ||
          (command.type === 'SaveEvent' &&
            command.event.status === 'cancelled' &&
            event?.id === command.event.id);
        const terminalTransfer = command.type === 'SaveTask' && !base.tasks[command.task.id]
          && command.task.handoff?.fromTaskId === task?.id && task?.resolution && ['completed', 'cancelled'].includes(task.status);
        if (work && !cancelling && !terminalTransfer)
          requireWorld(
            (work.status !== 'cancelled' || (command.type === 'SaveTask' && command.task.handoff?.fromTaskId === task?.id && task?.resolution)) &&
              Date.parse(work.startAt) <= Date.parse(proof.at) &&
              readyConditions(causal, [...work.prerequisites, ...work.blockers]),
          );
      }
    }
    const ownPrivateSources = (ref: ActorRef) =>
      origins.every(
        (source) =>
          source.ownerNpcId === undefined || (ref.kind === 'npc' && source.ownerNpcId === ref.id) ||
          (command.type === 'SaveTask' && !base.tasks[command.task.id] && command.task.handoff && source.id === `task:${command.task.handoff.fromTaskId}`),
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
          requireWorld(hasPlayerKnownFact(command, proof, origins), 'permission');
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
      case 'RetireNpc': {
        const npc = base.npc[command.npcId], decision = proof.decision;
        requireWorld(npc && actorAllowed({ kind: 'npc', id: npc.id }) && base.initialCompanionId !== npc.id, 'permission');
        requireWorld(tiedTo({ kind: 'npc', id: npc.id }) && ownPrivateSources({ kind: 'npc', id: npc.id }), 'permission');
        if (base.contactReviewNpcIds.includes(npc.id)) {
          const review = command.contactReview;
          // 自由文本子串与AI正文均不是独立玩家授权；没有可信确认入口时保守保护旧人。
          requireWorld(review?.conclusion === 'non_contact' && review.basis === 'no_known_connection'
            && !hasKnownPlayerConnection(base, npc.id), 'permission');
        }
        requireWorld(proof.kind === 'derived' || proof.kind === 'established');
        requireWorld(decision?.targetId === npc.id && decision.status === 'retired' && !decision.continues && decision.conditionsSatisfied
          && decision.reason === command.reason);
        break;
      }
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
        if (task.handoff && !old) {
          const transfer = task.handoff, prior = causal.tasks[transfer.fromTaskId];
          requireWorld(proof.kind === 'derived' || proof.kind === 'established');
          requireWorld(prior?.resolution && ['completed', 'cancelled'].includes(prior.status));
          requireWorld(actorAllowed(prior.actorRef), 'permission'); // 已退场者不能凭旧成果在当前凭空通信。
          requireWorld(proof.sources.includes(`task:${prior.id}`) && prior.resolution.result.includes(transfer.summaryBasis?.resultExcerpt ?? transfer.content));
          if (transfer.knowledgeKind === 'observed') requireWorld(prior.resolution.resultKnowledge?.facts.some(
            (fact) => fact.includes(transfer.summaryBasis?.resultExcerpt ?? transfer.content)));
          requireWorld(Date.parse(transfer.at) >= Date.parse(state.worldClock) && Date.parse(prior.resolution.at) <= Date.parse(transfer.at) && Date.parse(transfer.at) <= Date.parse(task.startAt)
            && Date.parse(transfer.at) <= Date.parse(proof.at));
          // 接收方有明确职责/能力来源；不以发送方秘密替代接收渠道。
          requireWorld(tiedTo(task.actorRef) || newActor(task.actorRef), 'permission');
        }
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
          requireWorld(proof.kind === 'planned' || proof.kind === 'established' || (proof.kind === 'derived' && task.handoff));
        if (task.status === 'blocked')
          requireWorld(
            proof.kind !== 'planned' && Date.parse(task.startAt) <= Date.parse(proof.at),
          );
        if (task.status === 'active' || task.status === 'completed') {
          requireWorld(
            proof.kind !== 'planned' && Date.parse(task.startAt) <= Date.parse(proof.at),
          );
          requireWorld(
            readyConditions(causal, [
              ...(old?.prerequisites ?? []),
              ...(old?.blockers ?? []),
              ...task.prerequisites,
              ...task.blockers,
            ]),
          );
        }
        const decision = proof.decision;
        if (decision) {
          requireWorld(decision.targetId === task.id && decision.status === task.status);
          requireWorld(decision.continues === (task.status === 'blocked'));
        }
        if (task.status === 'completed' || task.status === 'cancelled') {
          if (decision) {
            requireWorld(proof.kind === 'established' || proof.kind === 'derived');
            requireWorld(!old || proof.sources.includes(`task:${task.id}`));
            requireWorld(task.status !== 'completed' || (decision.conditionsSatisfied && !decision.failure
              && Date.parse(task.startAt) < Date.parse(proof.at)));
            const resolution = { at: proof.at, outcome: task.status === 'completed' ? 'success' as const
              : decision.failure ? 'failure' as const : 'cancelled' as const,
              result: decision.result, reason: decision.reason, sourceTurnId: draft.turnId,
              ...(decision.resultKnowledge ? { resultKnowledge: decision.resultKnowledge } : {}) };
            requireWorld(!task.resolution || fingerprint(task.resolution) === fingerprint(resolution));
            task.resolution = resolution;
          } else {
            if (task.status === 'completed') outcome(proof, origins, `task:${task.id}`, task.startAt, base.worldClock, Boolean(old));
            else { requireWorld(old); cancellationEvidence(proof, origins, `task:${task.id}`); }
            // 旧协议继续可读；新生成且具备具体成果的结果同样持久化，缺少成果不能同批释放任务。
            const resolution = old && ['completed', 'cancelled'].includes(old.status) ? old.resolution
              : { at: proof.at, outcome: task.status === 'completed' ? 'success' as const : 'cancelled' as const,
                result: proof.outcome ?? proof.fact, reason: proof.rationale, sourceTurnId: draft.turnId };
            requireWorld(task.resolution === undefined || fingerprint(task.resolution) === fingerprint(resolution));
            if (resolution) task.resolution = resolution;
          }
        } else requireWorld(task.resolution === undefined);
        break;
      }
      case 'SaveEvent': {
        const event = command.event,
          old = base.events[event.id];
        if (proof.decision) requireWorld(proof.decision.targetId === event.id && proof.decision.status === event.status
          && proof.decision.continues === (event.status === 'blocked'));
        // 预计时间是可调整的估计，非终态不能预存实际结案字段（空串也不接受）。
        if (['scheduled', 'active', 'blocked'].includes(event.status))
          requireWorld(event.resolvedAt === undefined && event.resolutionText === undefined && event.resultKnowledge === undefined);
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
            ref.kind === 'protagonist' ? ref.id === base.protagonist.id : actorAllowed(ref)
              || (ref.kind === 'npc' && base.retiredNpcs[ref.id] && old?.actorRefs.some((prior) => sameActor(prior, ref))),
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
            old.actorRefs.every((ref) => ref.kind === 'protagonist' || actorAllowed(ref)
              || (ref.kind === 'npc' && base.retiredNpcs[ref.id])),
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
            readyConditions(causal, [
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
          requireWorld(!proof.decision || (proof.decision.status === 'resolved' && event.resolutionText === proof.decision.result));
          requireWorld(event.resolvedAt && Date.parse(event.resolvedAt) === Date.parse(proof.at));
        }
        if (event.status === 'cancelled') {
          requireWorld(old);
          cancellationEvidence(proof, origins, `event:${event.id}`);
        }
        if (['resolved', 'cancelled'].includes(event.status)) {
          const knowledge = proof.decision?.resultKnowledge;
          if (knowledge) {
            requireWorld(!event.resultKnowledge || fingerprint(event.resultKnowledge) === fingerprint(knowledge));
            event.resultKnowledge = knowledge;
          } else requireWorld(event.resultKnowledge === undefined || (old && fingerprint(old) === fingerprint(event)));
        }
        // 候选不发布消息；模型也不能通过改 visibility 伪造主角已知。
        if (event.visibility !== 'hidden' && (event.visibility !== old?.visibility || event.title !== old?.title || event.status !== old?.status || event.resolutionText !== old?.resolutionText))
          requireWorld(hasPlayerKnownFact(command, proof, origins), 'permission');
        break;
      }
      default:
        requireWorld(false, 'permission');
    }
    if (command.type === 'CreateNpc' || command.type === 'CreateOrganization') {
      const key = command.type === 'CreateNpc' ? `npc:${command.npc.id}` : `org:${command.organization.id}`;
      if (command.type === 'CreateNpc') causal.npc[command.npc.id] = command.npc;
      else causal.organizations[command.organization.id] = command.organization;
      const added = worldSources(causal, draft, state).find((source) => source.id === key);
      requireWorld(added); sources.push({ ...added, at: proof.at });
    }
    if (command.type === 'SaveTask' || command.type === 'SaveEvent') {
      if (command.type === 'SaveTask') causal.tasks[command.task.id] = command.task;
      else causal.events[command.event.id] = command.event;
      const keys = command.type === 'SaveTask' ? [`task:${command.task.id}`, `task-plan:${command.task.id}`, `task-result:${command.task.id}`, `handoff:${command.task.id}`]
        : [`event:${command.event.id}`, `event-result:${command.event.id}`, `event-plan:${command.event.id}`];
      for (const id of keys) {
        const fresh = worldSources(causal, draft, state).find((source) => source.id === id);
        if (fresh) { const index = sources.findIndex((source) => source.id === id); if (index >= 0) sources[index] = fresh; else sources.push(fresh); }
      }
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
  let projected: GameState;
  try { projected = projectTurn(state, draft, commands); }
  catch (error) { if (error instanceof DataError && error.code === 'NPC_TASK_CONFLICT') requireWorld(false, 'npc_task_conflict'); throw error; }
  requireWorld(new Set(result.timelineCandidates).size === result.timelineCandidates.length);
  requireWorld(
    result.timelineCandidates.every(
      (id) =>
        projected.events[id]?.status === 'resolved' && projected.events[id]?.impact === 'major',
    ),
  );
  const conflicts = Object.values(base.npc).flatMap((npc) => {
    const tasks = Object.values(base.tasks).filter((task) => task.actorRef.kind === 'npc' && task.actorRef.id === npc.id && !['completed', 'cancelled'].includes(task.status));
    return tasks.length > 1 ? [`已有 NPC ${npc.id} 的未终结任务冲突：${tasks.map((task) => task.id).sort().join('、')}。未自动删除或改派任务；本轮不得新增占用。`] : [];
  });
  result.unresolved = [...new Set([...result.unresolved, ...conflicts])];
  return result;
}
