import { isHistoricalEntry } from '../../domain/events/lifecycle';
import type { GameState } from '../../domain/state';
import { initialCompanionProfile, matchesCompanion } from '../../services/local/companionProfile';
import type { CompanionProfile } from '../../services/local/companionProfile';
import { publicShortMemories } from '../../domain/memories/publicMemory';
import { historyRecords } from '../../domain/memories/history';
import { npcKnowledgeKind } from '../../domain/memories/schema';
import type { KnowledgeNatureSchema, MemoryEntrySchema, NpcSummarySchema } from '../../domain/memories/schema';
import type { z } from 'zod';

export interface ObservedMemory extends Omit<z.infer<typeof MemoryEntrySchema>, 'createdAtGameTime'> {
  createdAtGameTime?: string;
  recordKey: string;
  layer: string;
  tier: 'short' | 'medium' | 'long' | 'npc';
  origin: 'stored' | 'journal';
  ownerNpcId?: string;
  knowledgeKind?: z.infer<typeof KnowledgeNatureSchema>;
  knowledgeSource?: string;
  npcProvenance?: z.infer<typeof NpcSummarySchema>['npcProvenance'];
}

// 仅用于玩家只读观察。不得复用为Story或NPC认知上下文，不改变任何visibility/来源。
export function playerView(state: GameState, authoredCompanion?: CompanionProfile, effectiveWindowSize = state.memories.immediateWindowSize) {
  const archive = authoredCompanion ?? initialCompanionProfile(state);
  const companion = archive && matchesCompanion(state, archive) ? archive : undefined;
  const storedShortIds = new Set(state.memories.short.map(memory => memory.id));
  const publicShort = publicShortMemories(state).filter(memory => memory.origin !== 'journal' || !storedShortIds.has(memory.id));
  const displayedIds = new Set(publicShort.map(memory => memory.id));
  // 保留原公开来源排序与只读旧档投影；补全尚未显示的实际记录，不影响压缩候选或Story窗口。
  const short = [...publicShort, ...state.memories.short.filter(memory => !displayedIds.has(memory.id)).map(memory => ({ ...memory, origin: 'stored' as const }))];
  const journal = historyRecords(state.journal);
  const turnTimes = new Map(short.filter(memory => memory.visibility === 'player_known' && memory.origin === 'stored' && memory.sourceTurnIds.length === 1)
    .map(memory => [memory.sourceTurnIds[0], memory.createdAtGameTime]));
  const memories: ObservedMemory[] = [
    ...short.map(memory => ({ ...memory, recordKey: `short:${memory.id}`, tier: 'short' as const, layer: memory.origin === 'journal' ? '短期（历史摘要，只读）' : '短期' })),
    ...state.memories.medium.map(memory => ({ ...memory, recordKey: `medium:${memory.id}`, tier: 'medium' as const, origin: 'stored' as const, layer: '中期' })),
    ...state.memories.long.map(memory => ({ ...memory, recordKey: `long:${memory.id}`, tier: 'long' as const, origin: 'stored' as const, layer: memory.retiredNpcSource ? '退场人物保留记录' : '长期',
      ownerNpcId: memory.retiredNpcSource?.npcId, knowledgeKind: memory.retiredNpcSource?.knowledgeKind, knowledgeSource: memory.retiredNpcSource?.knowledgeSource })),
    ...Object.entries(state.memories.npcSummaries).flatMap(([npcId, entries]) => entries.map(memory => ({
      ...memory, recordKey: `summary:${npcId}:${memory.id}`, ownerNpcId: npcId, knowledgeKind: memory.npcProvenance?.knowledgeKind ?? 'unknown',
      tier: 'npc' as const, origin: 'stored' as const, layer: '人物总结',
    }))),
    ...Object.values(state.npc).flatMap(person => [
      ...person.memories.map(memory => ({ ...memory, layer: '人物原始记忆' })),
      ...(person.kind === 'special' ? person.longTermMemories.map(memory => ({ ...memory, layer: '人物长期记忆' })) : []),
    ].map(memory => ({ ...memory, recordKey: `npc:${person.id}:${memory.layer}:${memory.id}`, ownerNpcId: person.id,
      knowledgeKind: npcKnowledgeKind(memory), tier: 'npc' as const, origin: 'stored' as const }))),
  ];
  const npc = Object.values(state.npc).map(person => ({
    ...person,
    isContact: state.contactNpcIds.includes(person.id),
    contactReviewPending: state.contactReviewNpcIds.includes(person.id),
    affinity: person.id === state.initialCompanionId && !person.affinityConfirmed ? null : person.affinity,
    storedAffinity: person.affinity,
    profile: person.id === companion?.npcId ? companion.profile : undefined,
    authoredProfile: person.id === companion?.npcId ? companion : undefined,
    summaries: state.memories.npcSummaries[person.id] ?? [],
  }));
  return {
    npc, organizations: Object.values(state.organizations), items: Object.values(state.items),
    locations: Object.values(state.locations), events: Object.values(state.events),
    retiredEvents: Object.values(state.retiredEvents), retiredNpcs: Object.values(state.retiredNpcs),
    tasks: Object.values(state.tasks), economy: state.economy,
    protagonist: state.protagonist,
    timeline: state.timeline.filter(entry => isHistoricalEntry(state, entry)).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt)),
    memories,
    immediateMemories: journal.slice(-effectiveWindowSize).map(entry => ({ ...entry, createdAtGameTime: turnTimes.get(entry.turnId) })),
    immediateWindowSize: effectiveWindowSize,
    memoryLayers: {
      short: memories.filter(m => m.tier === 'short').length,
      medium: memories.filter(m => m.tier === 'medium').length,
      long: memories.filter(m => m.tier === 'long').length,
      npc: memories.filter(m => m.tier === 'npc').length,
    },
    journal,
  };
}
export type PlayerView = ReturnType<typeof playerView>;
export const money = (value: number | null) =>
  value === null
    ? '未确认'
    : `${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} 元`;
export const dateTime = (time: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Etc/GMT-8',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(time));
export const categoryLabels = {
  top: '上衣',
  bottom: '下装',
  shoes: '鞋子',
  accessory: '饰品',
  weapon: '武器',
  document: '文件',
  device: '设备',
  other: '其他',
};
export const orgLabels = {
  gang: '黑帮势力',
  government: '官方机构',
  civil: '民间组织',
  business: '企业与资本',
};
