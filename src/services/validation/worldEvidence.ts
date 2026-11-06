import { historicalEvent, terminalEvent } from '../../domain/events/lifecycle';
import { npcKnowledgeContext } from '../../domain/memories/npcMemory';
import { z } from 'zod';
import { GameTimeSchema, TextSchema, IdSchema, ActorRefSchema } from '../../domain/common';
import type { ActorRef } from '../../domain/common';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { DomainCommand } from '../../domain/commands';
import { affirmativeWorldSceneQuote, worldFactEvidence } from './evidence';
import { isNegatedFact } from '../../domain/factPolarity';
import { AiError } from '../ai/errors';
import type { WorldRule } from './worldDiagnostics';
import { TaskResultKnowledgeSchema } from '../../domain/events/schema';
import { derivedFactRule } from './worldFactNature';

// 来源凭据仍编码在原有evidence字符串中；可选成果分类从同次决策确定性写入resolution。
export const WorldEvidenceSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(['established', 'derived', 'planned', 'reported', 'suspected']),
  at: GameTimeSchema,
  sources: z
    .array(TextSchema.max(512))
    .min(1)
    .max(12)
    .refine((ids) => new Set(ids).size === ids.length),
  fact: TextSchema.max(8000),
  rationale: TextSchema.max(4000),
  // Optional current-scene record only. Quotes are authoritative; fact remains a non-executing synopsis.
  sceneRecord: z.strictObject({ anchors: z.array(z.strictObject({
    source: z.literal('story:current'), quote: TextSchema.max(2000),
    actorRefs: z.array(ActorRefSchema).min(1).max(12),
  })).min(1).max(12).refine(anchors => anchors.reduce((n, anchor) => n + anchor.quote.length, 0) <= 8000) }).optional(),
  outcome: TextSchema.max(4000).optional(),
  decision: z.strictObject({ targetId: IdSchema, status: z.enum(['completed', 'resolved', 'cancelled', 'blocked', 'retired']),
    reason: TextSchema.max(4000), result: TextSchema.max(4000), conditionsSatisfied: z.boolean(), continues: z.boolean(),
    failure: z.boolean().optional(),
    resultKnowledge: TaskResultKnowledgeSchema.optional(),
  }).optional(),
});
export type WorldEvidence = z.infer<typeof WorldEvidenceSchema>;
export interface WorldSource {
  id: string;
  knowledge: 'fact' | 'plan' | 'motive' | 'statement';
  text: string;
  actors: ActorRef[];
  ownerNpcId?: string;
  npcSummary?: boolean;
  worldEventOnly?: true;
  playerKnownText?: string;
  at?: string;
}
export const speculative =
  /准备|打算|计划|将要|明天|后天|如果|假如|假设|可能|或许|预计|声称|自称|谎称|听说|据说|传闻|据传|猜测/;
export function hasAffirmedTermination(text: string) {
  // 接受明确的动作完成/终止谓语，不把“整理取消通知”等名词提及当作已终止。
  const statements =
    /(?:已经|现已|已|正式|最终)(?:被)?(?:取消|撤销|终止|放弃|叫停|停止执行)|(?:取消|撤销|终止|放弃|叫停)了|(?:任务|事件|行动|工作|安排|排程)(?:被)?(?:取消|撤销|终止|放弃|叫停)(?=[。！？；，,\n]|$)/g;
  return [...text.matchAll(statements)].some(
    (match) => !isNegatedFact(text, match.index, match.index + match[0].length),
  );
}
export function worldSources(state: GameState, draft: TurnDraft, before = state): WorldSource[] {
  const sources: WorldSource[] = [
    { id: 'story:current', knowledge: 'fact', text: draft.story?.narrative ?? '', playerKnownText: draft.story?.narrative ?? '', actors: [] },
  ];
  for (const npc of Object.values(state.npc).filter(
    (person) => !person.onScene && !before.npc[person.id]?.onScene,
  )) {
    sources.push({
      id: `npc:${npc.id}`,
      knowledge: 'motive',
      text: JSON.stringify({
        id: npc.id,
        name: npc.name,
        identity: npc.identity,
        background: npc.background,
        healthText: npc.healthText,
        locationId: npc.locationId,
        skills: npc.skills,
        habits: npc.kind === 'special' ? npc.habits : undefined,
      }),
      actors: [{ kind: 'npc', id: npc.id }],
      ownerNpcId: npc.id,
    });
    if (npc.kind === 'special')
      npc.activeGoals.forEach((text, index) =>
        sources.push({
          id: `goal:${npc.id}:${index}`,
          knowledge: 'motive',
          text,
          actors: [{ kind: 'npc', id: npc.id }],
          ownerNpcId: npc.id,
        }),
      );
    const knowledge = npcKnowledgeContext(state, npc.id);
    for (const summary of knowledge.summaries) sources.push({
      id: `npc-summary:${npc.id}:${summary.id}`, knowledge: 'motive', text: summary.text,
      actors: [{ kind: 'npc', id: npc.id }], ownerNpcId: npc.id, at: summary.createdAtGameTime, npcSummary: true,
    });
    for (const memory of knowledge.raw)
      sources.push({
        id: `memory:${npc.id}:${memory.id}`,
        knowledge:
          memory.knowledgeKind !== 'observed' || speculative.test(memory.knowledgeSource)
            ? 'statement'
            : 'fact',
        text: memory.text,
        playerKnownText: memory.visibility === 'player_known' ? memory.text : undefined,
        actors: [{ kind: 'npc', id: npc.id }],
        ownerNpcId: npc.id,
        at: memory.createdAtGameTime,
      });
    npc.knownInformation.forEach((info, index) => {
      if ([...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])].some((memory) => memory.text === info.text && memory.knowledgeSource === info.source)) return;
      sources.push({
        id: `knowledge:${npc.id}:${index}`,
        knowledge:
          /^\[(?:转述|推测)\]/.test(info.text) || speculative.test(info.source)
            ? 'statement'
            : 'fact',
        text: info.text,
        actors: [{ kind: 'npc', id: npc.id }],
        ownerNpcId: npc.id,
        at: info.learnedAt,
      });
    });
  }
  for (const org of Object.values(state.organizations))
    sources.push({
      id: `org:${org.id}`,
      knowledge: 'motive',
      text: JSON.stringify(org),
      actors: [{ kind: 'organization', id: org.id }],
    });
  for (const history of Object.values(state.retiredNpcs)) sources.push({ id: `identity:${history.id}`, knowledge: 'fact', text: JSON.stringify(history), actors: [] });
  for (const task of Object.values(state.tasks)) {
    if (
      task.actorRef.kind === 'protagonist' ||
      (task.actorRef.kind === 'npc' &&
        (state.npc[task.actorRef.id]?.onScene || before.npc[task.actorRef.id]?.onScene))
    )
      continue;
    sources.push({
      id: `task:${task.id}`,
      ownerNpcId: task.actorRef.kind === 'npc' ? task.actorRef.id : undefined,
      knowledge: task.resolution ? 'fact' : 'plan',
      // 任务终态/时间是程序事实；混合成果叙述不自动成为事实，只投影明确分层的事实。
      text: JSON.stringify(task.resolution ? { id: task.id, status: task.status,
        at: task.resolution.at, facts: task.resolution.resultKnowledge?.facts ?? [] } : { ...task, handoff: undefined }),
      actors: [task.actorRef],
      at: task.resolution?.at,
    });
    if (task.resolution) sources.push({ id: `task-result:${task.id}`, knowledge: 'statement',
      text: JSON.stringify({ result: task.resolution.result,
        reported: task.resolution.resultKnowledge?.reported ?? [], suspected: task.resolution.resultKnowledge?.suspected ?? [] }),
      actors: [task.actorRef], ownerNpcId: task.actorRef.kind === 'npc' ? task.actorRef.id : undefined,
      at: task.resolution.at });
    if (task.resolution) sources.push({ id: `task-plan:${task.id}`, knowledge: 'plan',
      text: JSON.stringify({ id: task.id, goal: task.goal, startAt: task.startAt, dueAt: task.dueAt,
        completionCondition: task.completionCondition, prerequisites: task.prerequisites, blockers: task.blockers,
        reason: task.resolution.reason }),
      actors: [task.actorRef], ownerNpcId: task.actorRef.kind === 'npc' ? task.actorRef.id : undefined });
    if (task.handoff) sources.push({ id: `handoff:${task.id}`, knowledge: task.handoff.knowledgeKind === 'reported' ? 'statement' : 'fact',
      text: task.handoff.content, actors: [task.actorRef], ownerNpcId: task.actorRef.kind === 'npc' ? task.actorRef.id : undefined, at: task.handoff.at });
  }
  const eventViews = [...Object.values(state.events), ...Object.keys(state.retiredEvents).flatMap(id => { const view=historicalEvent(state,id); return view ? [view] : []; })];
  for (const event of eventViews) {
    const terminal = ['resolved', 'cancelled'].includes(event.status);
    // 现场sceneState只观察状态/结果，不会公开World另行修改的标题、背景或排程。
    // 快照存在期间，整条事件来源继续仅供世界推演；人物应使用独立知晓渠道。
    const progressKnown = event.visibility === 'known' && !event.protagonistKnowledge;
    const metadata = { id: event.id, status: event.status, startAt: event.startAt,
      resolvedAt: event.resolvedAt, locationId: event.locationId, actorRefs: event.actorRefs,
      facts: event.resultKnowledge?.facts ?? [] };
    sources.push({
      id: `event:${event.id}`,
      // 参与者/事件客观状态不代表人物已经获知；旧档同样按当前可见性重建边界。
      worldEventOnly: !progressKnown ? true : undefined,
      playerKnownText: progressKnown ? JSON.stringify(metadata) : undefined,
      knowledge: terminalEvent(event) ? 'fact' : event.estimatedEndAt && Date.parse(event.estimatedEndAt)<=Date.parse(state.worldClock) ? 'motive' : 'plan',
      text: JSON.stringify(terminal ? metadata : event),
      actors: event.actorRefs,
      at: event.resolvedAt,
    });
    if (terminal) {
      sources.push({ id: `event-result:${event.id}`, knowledge: 'statement',
        text: JSON.stringify({ title: event.title, resolutionText: event.resolutionText,
          reported: event.resultKnowledge?.reported ?? [], suspected: event.resultKnowledge?.suspected ?? [] }),
        actors: event.actorRefs, worldEventOnly: !progressKnown ? true : undefined, at: event.resolvedAt });
      sources.push({ id: `event-plan:${event.id}`, knowledge: 'plan',
        text: JSON.stringify({ title: event.title, completionCondition: 'completionCondition' in event ? event.completionCondition : undefined,
          estimatedEndAt: event.estimatedEndAt, prerequisites: 'prerequisites' in event ? event.prerequisites : undefined, blockers: 'blockers' in event ? event.blockers : undefined }),
        actors: event.actorRefs, worldEventOnly: !progressKnown ? true : undefined });
    }
  }
  return sources;
}
export function requireWorld(
  ok: unknown,
  code: 'invalid_output' | 'permission' | 'npc_task_conflict' = 'invalid_output',
  worldRule?: WorldRule,
): asserts ok {
  if (!ok) throw new AiError(code, undefined, worldRule ? { worldRule } : undefined);
}
function affirmativeSceneQuote(command: DomainCommand, narrative: string, quote: string) {
  return affirmativeWorldSceneQuote(command, narrative, quote);
}
export function readWorldEvidence(
  command: DomainCommand,
  sources: readonly WorldSource[],
  from: string,
  to: string,
) {
  let raw: unknown;
  try {
    raw = JSON.parse(command.evidence);
  } catch {
    throw new AiError('invalid_output', undefined, { worldRule: 'source_format', fieldPath: 'evidence' });
  }
  const checked = WorldEvidenceSchema.safeParse(raw);
  requireWorld(checked.success, 'invalid_output', 'source_format');
  const proof = checked.data;
  requireWorld(Date.parse(proof.at) >= Date.parse(from) && Date.parse(proof.at) <= Date.parse(to), 'invalid_output', 'source_time');
  const resolved = proof.sources.map((id) => {
    const source = sources.find((item) => item.id === id);
    requireWorld(source, 'invalid_output', 'source_missing');
    requireWorld(!source.at || Date.parse(source.at) <= Date.parse(proof.at), 'invalid_output', 'source_time');
    return source;
  });
  if (proof.sceneRecord) {
    requireWorld(command.type === 'SaveEvent' && proof.kind === 'established'
      && ['active', 'blocked'].includes(command.event.status) && !proof.decision && !proof.outcome,
    'permission', 'actor_permission');
    const story = resolved.find(source => source.id === 'story:current' && source.knowledge === 'fact');
    requireWorld(story, 'invalid_output', 'source_missing');
    const quotes = proof.sceneRecord.anchors.map(anchor => anchor.quote);
    requireWorld(new Set(quotes).size === quotes.length, 'invalid_output', 'source_format');
    for (const [index, quote] of quotes.entries())
      if (!affirmativeSceneQuote(command, story.text, quote)) throw new AiError('invalid_output', undefined, {
        worldRule: 'source_knowledge', fieldPath: `evidence.sceneRecord.anchors.${index}.quote`,
      });
    // Never let the model's paraphrase turn into a fact/knowledge source or a completion proof.
    // No mutation of raw response/evidence: candidates are revalidated from the same source anchors.
    proof.fact = quotes.join('\n');
  }
  // 非公开事件供世界因果/生命周期推演，不直接授予任何NPC知识。
  // 人物行动或新认知应引用其独立观察/转述等自身来源，不能借事件ID洗掉所属关系。
  const npcCommand = command.type === 'UpdateNpc' || command.type === 'RecordNpcMemory' || command.type === 'RetireNpc' ||
    command.type === 'SaveTask';
  requireWorld(!npcCommand || !resolved.some((source) => source.worldEventOnly), 'permission', 'source_owner');
  if (resolved.some((source) => source.npcSummary)) {
    // 总结不是事实凭据；只允许同一所属人物的未执行计划，不能传播或更新世界真值。
    const owner = command.type === 'SaveTask' && command.task.status === 'planned' && command.task.actorRef.kind === 'npc'
      ? command.task.actorRef.id : command.type === 'UpdateNpc' && Object.keys(command.changes).length === 0 && !command.affinityChange && command.activeGoals !== undefined ? command.npcId : undefined;
    requireWorld(proof.kind === 'planned' && owner && resolved.every((source) => !source.ownerNpcId || source.ownerNpcId === owner), 'permission', 'source_owner');
  }
  if (proof.kind === 'reported' || proof.kind === 'suspected') {
    requireWorld(
      command.type === 'RecordNpcMemory' && command.knowledgeKind === proof.kind,
      'permission',
    );
    requireWorld(
      resolved.some(
        (source) => source.knowledge === 'statement' && source.text.includes(proof.fact),
      ),
    );
  } else {
    if (proof.kind !== 'planned')
      requireWorld(!resolved.some((source) => source.knowledge === 'statement'), 'invalid_output', 'source_knowledge');
    if (proof.kind === 'established' && !proof.sceneRecord) {
      requireWorld(
        resolved.some((source) => {
          if (source.knowledge !== 'fact' || !source.text.includes(proof.fact)) return false;
          try {
            worldFactEvidence({ ...command, evidence: proof.fact }, source.text);
            return true;
          } catch {
            return false;
          }
        }), 'invalid_output', 'source_knowledge',
      );
    } else if (proof.kind === 'derived') {
      requireWorld(
        resolved.some((source) => source.knowledge === 'motive' || source.knowledge === 'fact'), 'invalid_output', 'source_knowledge',
      );
      // 生命周期的明确结构化决策由同次世界AI作语义判断；不用固定词汇审判复杂结果。
      // 来源、时间、目标/状态、条件和权限仍由后续验证器逐项约束。其他事实命令保持原保护。
      const decision = proof.decision;
      const lifecycleDecision = decision && (
        (command.type === 'SaveTask' && decision.targetId === command.task.id && decision.status === command.task.status)
        || (command.type === 'SaveEvent' && decision.targetId === command.event.id && decision.status === command.event.status)
        || (command.type === 'RetireNpc' && decision.targetId === command.npcId && decision.status === 'retired')
        || ((command.type === 'DeleteEvent' || command.type === 'ArchiveEvent') && decision.targetId === command.eventId && decision.status === 'retired'));
      if (!lifecycleDecision) {
        const cancellation = (command.type === 'SaveTask' && command.task.status === 'cancelled')
          || (command.type === 'SaveEvent' && command.event.status === 'cancelled');
        const affirmedTermination = cancellation && hasAffirmedTermination(proof.fact);
        const rule = derivedFactRule(proof.fact, Boolean(affirmedTermination));
        if (rule) throw new AiError('invalid_output', undefined, { worldRule: rule, fieldPath: 'evidence.fact' });
      }
    }
  }
  return { proof, sources: resolved };
}

// “客观已发生”与“玩家已获知”是两条独立约束；仅承认可公开投影中的肯定事实。
export function hasPlayerKnownFact(command: DomainCommand, proof: WorldEvidence, sources: readonly WorldSource[]) {
  const anchors = proof.sceneRecord?.anchors;
  if (anchors) return command.type === 'SaveEvent' && proof.kind === 'established'
    && ['active', 'blocked'].includes(command.event.status) && anchors.length > 0
    && sources.some(source => source.id === 'story:current' && source.knowledge === 'fact' && source.playerKnownText === source.text
      && anchors.every(anchor => affirmativeSceneQuote(command, source.text, anchor.quote)));
  return proof.kind === 'established' && sources.some((source) => {
    if (source.knowledge !== 'fact' || !source.playerKnownText?.includes(proof.fact)) return false;
    try { worldFactEvidence({ ...command, evidence: proof.fact }, source.playerKnownText); return true; } catch { return false; }
  });
}

/** Learning that a future arrangement exists does not establish its execution or hidden details. */
export function hasPlayerKnownArrangement(proof: WorldEvidence, sources: readonly WorldSource[]) {
  return proof.kind === 'planned' && sources.some(source => (source.knowledge === 'fact' || source.knowledge === 'statement')
    && source.playerKnownText?.includes(proof.fact));
}
