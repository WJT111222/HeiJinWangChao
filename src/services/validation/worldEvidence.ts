import { z } from 'zod';
import { GameTimeSchema, TextSchema } from '../../domain/common';
import type { ActorRef } from '../../domain/common';
import type { GameState } from '../../domain/state';
import type { TurnDraft } from '../../domain/drafts';
import type { DomainCommand } from '../../domain/commands';
import { factEvidence } from './evidence';
import { isNegatedFact } from '../../domain/factPolarity';
import { AiError } from '../ai/errors';

// 来源凭据编码在原有 evidence 字符串中，不新增正式存档或草稿字段。
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
  outcome: TextSchema.max(4000).optional(),
});
export type WorldEvidence = z.infer<typeof WorldEvidenceSchema>;
export interface WorldSource {
  id: string;
  knowledge: 'fact' | 'plan' | 'motive' | 'statement';
  text: string;
  actors: ActorRef[];
  ownerNpcId?: string;
  at?: string;
}
export const speculative =
  /准备|打算|计划|将要|明天|后天|如果|假如|假设|可能|或许|预计|声称|自称|谎称|听说|据说|传闻|据传|猜测/;
export function worldSources(state: GameState, draft: TurnDraft, before = state): WorldSource[] {
  const sources: WorldSource[] = [
    { id: 'story:current', knowledge: 'fact', text: draft.story?.narrative ?? '', actors: [] },
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
    for (const memory of [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])])
      sources.push({
        id: `memory:${npc.id}:${memory.id}`,
        knowledge:
          /^\[(?:转述|推测)\]/.test(memory.text) || speculative.test(memory.knowledgeSource)
            ? 'statement'
            : 'fact',
        text: memory.text,
        actors: [{ kind: 'npc', id: npc.id }],
        ownerNpcId: npc.id,
        at: memory.createdAtGameTime,
      });
    npc.knownInformation.forEach((info, index) =>
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
      }),
    );
  }
  for (const org of Object.values(state.organizations))
    sources.push({
      id: `org:${org.id}`,
      knowledge: 'motive',
      text: JSON.stringify(org),
      actors: [{ kind: 'organization', id: org.id }],
    });
  for (const task of Object.values(state.tasks)) {
    if (
      task.actorRef.kind === 'protagonist' ||
      (task.actorRef.kind === 'npc' &&
        (state.npc[task.actorRef.id]?.onScene || before.npc[task.actorRef.id]?.onScene))
    )
      continue;
    sources.push({
      id: `task:${task.id}`,
      knowledge: task.status === 'completed' ? 'fact' : 'plan',
      text: JSON.stringify(task),
      actors: [task.actorRef],
    });
  }
  for (const event of Object.values(state.events))
    sources.push({
      id: `event:${event.id}`,
      knowledge: event.status === 'resolved' ? 'fact' : 'plan',
      text: JSON.stringify(event),
      actors: event.actorRefs,
      at: event.resolvedAt,
    });
  return sources;
}
export function requireWorld(
  ok: unknown,
  code: 'invalid_output' | 'permission' = 'invalid_output',
): asserts ok {
  if (!ok) throw new AiError(code);
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
    throw new AiError('invalid_output');
  }
  const checked = WorldEvidenceSchema.safeParse(raw);
  requireWorld(checked.success);
  const proof = checked.data;
  requireWorld(Date.parse(proof.at) >= Date.parse(from) && Date.parse(proof.at) <= Date.parse(to));
  const resolved = proof.sources.map((id) => {
    const source = sources.find((item) => item.id === id);
    requireWorld(source && (!source.at || Date.parse(source.at) <= Date.parse(proof.at)));
    return source;
  });
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
      requireWorld(!resolved.some((source) => source.knowledge === 'statement'));
    if (proof.kind === 'established') {
      requireWorld(
        resolved.some((source) => {
          if (source.knowledge !== 'fact' || !source.text.includes(proof.fact)) return false;
          try {
            factEvidence({ ...command, evidence: proof.fact }, source.text);
            return true;
          } catch {
            return false;
          }
        }),
      );
    } else if (proof.kind === 'derived') {
      requireWorld(
        resolved.some((source) => source.knowledge === 'motive' || source.knowledge === 'fact'),
      );
      requireWorld(!speculative.test(proof.fact) && !isNegatedFact(proof.fact));
    }
  }
  return { proof, sources: resolved };
}
