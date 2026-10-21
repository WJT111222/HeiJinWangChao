import { z } from 'zod';
import { DataError, GameTimeSchema, IdSchema, requireData, TextSchema } from '../common';
import { GameStateSchema } from '../state';
import type { GameState } from '../state';
import { fingerprint } from '../commands';
import { KnowledgeNatureSchema, NpcMemorySchema, NpcSummarySchema, npcKnowledgeKind } from './schema';
import { compressionPolicy, sourceUnion } from './compression';
import { estimateTokens } from '../../prompts/statistics';

export const npcMemoryPolicy = { threshold: 20, batchSize: 10, contextRawLimit: 20, contextSummaryLimit: 10, contextCharacters: 16000 } as const;
export const NpcMemoryBatchSchema = z.strictObject({
  saveId: IdSchema, saveCreatedAt: GameTimeSchema, npcId: IdSchema, identityKey: TextSchema,
  entries: z.array(NpcMemorySchema.refine((entry) => entry.visibility !== 'internal', '内部世界资料不是NPC已知记忆')).min(2).max(npcMemoryPolicy.batchSize),
});
export type NpcMemoryBatch = z.infer<typeof NpcMemoryBatchSchema>;
export const rawNpcMemories = (npc: GameState['npc'][string]) => [...npc.memories, ...(npc.kind === 'special' ? npc.longTermMemories : [])];
const summaryVisibility = (visibility: z.infer<typeof NpcMemorySchema>['visibility']) => visibility === 'internal' ? 'internal' as const : 'npc_private' as const;

export function validNpcSummary(state: GameState, npcId: string, summary: z.infer<typeof NpcSummarySchema>) {
  const npc = state.npc[npcId], provenance = summary.npcProvenance;
  if (!npc || !provenance || summary.visibility === 'internal' || provenance.sourceVisibility === 'internal' || provenance.npcId !== npc.id || provenance.identityKey !== npc.identityKey ||
    summary.visibility !== summaryVisibility(provenance.sourceVisibility) || Date.parse(summary.createdAtGameTime) > Date.parse(state.worldClock)) return false;
  const raw = rawNpcMemories(npc);
  return provenance.sourceMemoryIds.every((id) => {
    const entries = raw.filter((entry) => entry.id === id);
    return entries.length === 1 && entries[0].visibility === provenance.sourceVisibility && npcKnowledgeKind(entries[0]) === provenance.knowledgeKind;
  });
}
export function npcSummaryCandidates(state: GameState, npcId: string) {
  const npc = state.npc[npcId];
  if (!npc) return [];
  const summaries = state.memories.npcSummaries[npcId] ?? [];
  // 无来源的旧总结不能可靠判定覆盖范围，保守保留且暂停对该人物的付费重复归纳。
  if (summaries.some((entry) => !validNpcSummary(state, npcId, entry))) return [];
  const covered = new Set(summaries.flatMap((entry) => entry.npcProvenance?.sourceMemoryIds ?? []));
  const ids = new Map<string, number>();
  for (const memory of Object.values(state.npc).flatMap(rawNpcMemories)) ids.set(memory.id, (ids.get(memory.id) ?? 0) + 1);
  return rawNpcMemories(npc).filter((entry) => entry.visibility !== 'internal' && !covered.has(entry.id) && ids.get(entry.id) === 1 &&
    entry.affectedEntityRefs.some((ref) => ref.kind === 'npc' && ref.id === npcId) &&
    Date.parse(entry.createdAtGameTime) <= Date.parse(state.worldClock))
    .sort((a, b) => Date.parse(a.createdAtGameTime) - Date.parse(b.createdAtGameTime));
}
export const npcMaintenanceAvailable = (state: GameState) => Object.keys(state.npc).some((id) => npcSummaryCandidates(state, id).length > npcMemoryPolicy.threshold);
export function npcSummaryInput(batch: NpcMemoryBatch) {
  const groups = new Map<string, { groupId: string; knowledgeKind: z.infer<typeof KnowledgeNatureSchema>; visibility: z.infer<typeof NpcMemorySchema>['visibility']; entries: NpcMemoryBatch['entries'] }>();
  for (const entry of batch.entries) {
    const knowledgeKind = npcKnowledgeKind(entry), groupId = `${knowledgeKind}:${entry.visibility}`;
    const group = groups.get(groupId) ?? { groupId, knowledgeKind, visibility: entry.visibility, entries: [] };
    group.entries.push(entry); groups.set(groupId, group);
  }
  return { task: 'memory.npc_summarize', npcId: batch.npcId, groups: [...groups.values()] };
}
export function planNpcSummary(state: GameState, npcId?: string): NpcMemoryBatch | undefined {
  if (npcId) { IdSchema.parse(npcId); requireData(Object.hasOwn(state.npc, npcId), 'NPC_MEMORY_CONFLICT', '人物来源已变化，未发起维护'); }
  for (const npc of Object.values(state.npc).filter((person) => !npcId || person.id === npcId).sort((a, b) => a.id.localeCompare(b.id))) {
    const candidates = npcSummaryCandidates(state, npc.id);
    if (candidates.length <= npcMemoryPolicy.threshold) continue;
    const batch: NpcMemoryBatch = { saveId: state.saveId, saveCreatedAt: state.createdAt, npcId: npc.id, identityKey: npc.identityKey, entries: [] };
    for (const entry of candidates.slice(0, npcMemoryPolicy.batchSize)) {
      const next = { ...batch, entries: [...batch.entries, entry] };
      const text = JSON.stringify(npcSummaryInput(next)).replace(/[<>&]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      if (text.length > compressionPolicy.inputCharacters || estimateTokens(text).estimatedTokens > compressionPolicy.inputEstimatedTokens) break;
      batch.entries.push(entry);
    }
    requireData(batch.entries.length >= 2, 'MEMORY_BUDGET', '原始条目超出整理预算，未调用模型');
    return NpcMemoryBatchSchema.parse(batch);
  }
}
export const NpcSummaryOutputSchema = z.strictObject({
  summaries: z.array(z.strictObject({ groupId: z.string(), text: TextSchema.max(4000) })).min(1).max(10),
  unresolved: z.array(z.string()), contradictions: z.array(z.string()),
});
const labels = { observed: '[亲历]', reported: '[转述]', suspected: '[推测]', unknown: '[来源未分类]' };
export function parseNpcSummary(text: string, batch: NpcMemoryBatch, id: string) {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new DataError('MEMORY_OUTPUT', '整理结果不是完整JSON，原始记忆已保留'); }
  const parsed = NpcSummaryOutputSchema.safeParse(raw), groups = npcSummaryInput(batch).groups;
  requireData(parsed.success && !parsed.data.unresolved.length && !parsed.data.contradictions.length,
    'MEMORY_OUTPUT', '整理输出存在非法字段、未解决事项或矛盾，原始记忆已保留');
  requireData(parsed.data.summaries.length === groups.length &&
    new Set(parsed.data.summaries.map((entry) => entry.groupId)).size === groups.length &&
    parsed.data.summaries.every((entry) => groups.some((group) => group.groupId === entry.groupId)) &&
    parsed.data.summaries.reduce((sum, entry) => sum + entry.text.length, 0) <= 4000, 'MEMORY_OUTPUT', '认知分组不完整或超预算');
  return groups.map((group, index) => NpcSummarySchema.parse({
    id: `${id}-${index}`, text: labels[group.knowledgeKind] + parsed.data.summaries.find((entry) => entry.groupId === group.groupId)!.text,
    sourceTurnIds: sourceUnion(group.entries),
    affectedEntityRefs: [...new Map(group.entries.flatMap((entry) => entry.affectedEntityRefs).map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()],
    createdAtGameTime: group.entries.reduce((last, entry) => Date.parse(entry.createdAtGameTime) > Date.parse(last) ? entry.createdAtGameTime : last, group.entries[0].createdAtGameTime),
    visibility: summaryVisibility(group.visibility),
    npcProvenance: { npcId: batch.npcId, identityKey: batch.identityKey, sourceMemoryIds: group.entries.map((entry) => entry.id), knowledgeKind: group.knowledgeKind, sourceVisibility: group.visibility },
  }));
}
export function applyNpcSummary(state: GameState, input: NpcMemoryBatch, summaries: z.infer<typeof NpcSummarySchema>[]): GameState {
  const batch = NpcMemoryBatchSchema.parse(input), npc = state.npc[batch.npcId];
  requireData(state.saveId === batch.saveId && state.createdAt === batch.saveCreatedAt && npc?.identityKey === batch.identityKey, 'NPC_MEMORY_CONFLICT', '人物或存档身份已变化');
  const eligible = npcSummaryCandidates(state, batch.npcId);
  requireData(new Set(batch.entries.map((entry) => entry.id)).size === batch.entries.length && batch.entries.every((entry) =>
    eligible.some((current) => current.id === entry.id && fingerprint(current) === fingerprint(entry))), 'NPC_MEMORY_CONFLICT', '来源已变化或已被整理');
  const groups = npcSummaryInput(batch).groups;
  requireData(summaries.length === groups.length && new Set(summaries.map((summary) => summary.id)).size === summaries.length, 'MEMORY_OUTPUT', '整理结果缺失或重复');
  const allIds = [...Object.values(state.npc).flatMap(rawNpcMemories), ...state.memories.short, ...state.memories.medium, ...state.memories.long, ...Object.values(state.memories.npcSummaries).flat()].map((entry) => entry.id);
  const texts = summaries.map((summary, index) => {
    requireData(!allIds.includes(summary.id), 'NPC_MEMORY_CONFLICT', '整理结果已存在');
    const group = groups[index], label = labels[group.knowledgeKind];
    requireData(summary.text.startsWith(label), 'MEMORY_OUTPUT', '认知性质丢失');
    return { groupId: group.groupId, text: summary.text.slice(label.length) };
  });
  const expected = parseNpcSummary(JSON.stringify({ summaries: texts, unresolved: [], contradictions: [] }), batch, 'validate');
  requireData(expected.every((entry, index) => fingerprint({ ...entry, id: summaries[index].id }) === fingerprint(NpcSummarySchema.parse(summaries[index]))),
    'MEMORY_OUTPUT', '来源或权限元数据不符');
  return GameStateSchema.parse({ ...state, memories: { ...state.memories, npcSummaries: { ...state.memories.npcSummaries, [npc.id]: [...(state.memories.npcSummaries[npc.id] ?? []), ...summaries] } } });
}

// 只作内部认知资料，不把私人总结作为世界客观事实。
export function npcKnowledgeContext(state: GameState, npcId: string) {
  const npc = state.npc[npcId];
  if (!npc) return { ownerNpcId: npcId, raw: [], summaries: [] };
  const summaries = (state.memories.npcSummaries[npcId] ?? []).filter((entry) => validNpcSummary(state, npcId, entry));
  const covered = new Set(summaries.flatMap((entry) => entry.npcProvenance?.sourceMemoryIds ?? []));
  let budget = npcMemoryPolicy.contextCharacters;
  const fits = <T,>(value: T) => { const size = JSON.stringify(value).length; if (size > budget) return false; budget -= size; return true; };
  const selectedSummaries = [...summaries].reverse().slice(0, npcMemoryPolicy.contextSummaryLimit).filter(fits);
  const raw = rawNpcMemories(npc).filter((entry) => entry.visibility !== 'internal' && !covered.has(entry.id) && Date.parse(entry.createdAtGameTime) <= Date.parse(state.worldClock)).reverse().sort((a, b) => Date.parse(b.createdAtGameTime) - Date.parse(a.createdAtGameTime))
    .slice(0, npcMemoryPolicy.contextRawLimit).map((entry) => ({ ...entry, knowledgeKind: npcKnowledgeKind(entry) })).filter(fits);
  return { ownerNpcId: npcId, summaries: selectedSummaries, raw };
}
