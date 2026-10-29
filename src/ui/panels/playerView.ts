import { isPublicHistory } from '../../domain/events/lifecycle';
import type { GameState } from '../../domain/state';
import { initialCompanionProfile, matchesCompanion } from '../../services/local/companionProfile';
import type { CompanionProfile } from '../../services/local/companionProfile';
import { publicShortMemories } from '../../domain/memories/publicMemory';
import { historyRecords } from '../../domain/memories/history';

// M2 展示投影；玩家视角与主角认知并非同一概念，最终档案开放范围尚待设计。
export function playerView(state: GameState, authoredCompanion?: CompanionProfile, effectiveWindowSize = state.memories.immediateWindowSize) {
  const archive = authoredCompanion ?? initialCompanionProfile(state);
  const companion = archive && matchesCompanion(state, archive) ? archive : undefined;
  const events = Object.values(state.events).filter((event) => event.visibility === 'known');
  const short = publicShortMemories(state);
  const journal = historyRecords(state.journal);
  const turnTimes = new Map(short.filter((memory) => memory.origin === 'stored' && memory.sourceTurnIds.length === 1)
    .map((memory) => [memory.sourceTurnIds[0], memory.createdAtGameTime]));
  const memories = [
    ...short.map((memory) => ({ ...memory, tier: 'short' as const, layer: memory.origin === 'journal' ? '短期（历史摘要，只读）' : '短期' })),
    ...state.memories.medium.map((memory) => ({ ...memory, tier: 'medium' as const, origin: 'stored' as const, layer: '中期' })),
    ...state.memories.long.map((memory) => ({ ...memory, tier: 'long' as const, origin: 'stored' as const, layer: '长期' })),
    ...Object.values(state.memories.npcSummaries)
      .flat()
      .map((memory) => ({ ...memory, tier: 'long' as const, origin: 'stored' as const, layer: '人物摘要' })),
    ...Object.values(state.npc).flatMap((npc) => [
      ...npc.memories.map((memory) => ({ ...memory, tier: 'short' as const, origin: 'stored' as const, layer: '人物记忆' })),
      ...(npc.kind === 'special'
        ? npc.longTermMemories.map((memory) => ({ ...memory, tier: 'long' as const, origin: 'stored' as const, layer: '人物长期记忆' }))
        : []),
    ]),
  ].filter((memory) => memory.visibility === 'player_known');
  const knownActors = new Set(
    [
      ...state.journal.flatMap((entry) => entry.relatedActorRefs),
      ...events.flatMap((event) => event.actorRefs),
      ...memories.flatMap((memory) => memory.affectedEntityRefs),
    ].map((ref) => `${ref.kind}:${ref.id}`),
  );
  const npc = Object.values(state.npc)
    .filter(
      (person) =>
        person.onScene ||
        person.lastInteractionAt ||
        person.id === state.initialCompanionId ||
        knownActors.has(`npc:${person.id}`),
    )
    .map((person) => ({
      id: person.id,
      isContact: state.contactNpcIds.includes(person.id),
      contactReviewPending: state.contactReviewNpcIds.includes(person.id),
      name: person.id === companion?.npcId ? companion.name : person.name,
      kind: person.kind,
      // M2 暂不凭在场或引用公开内部身份/关系，不定义最终的玩家视角模式。
      relationshipText: person.id === companion?.npcId ? companion.relationshipText : undefined,
      affinity: person.id === state.initialCompanionId && !person.affinityConfirmed ? null : person.affinity,
      locationId: person.onScene ? person.locationId : undefined,
      onScene: person.onScene,
      identity: person.id === companion?.npcId ? companion.identity : undefined,
      profile: person.id === companion?.npcId ? companion.profile : undefined,
    }));
  const organizations = Object.values(state.organizations)
    .filter((org) => knownActors.has(`organization:${org.id}`))
    .map((org) => ({
      id: org.id,
      name: org.name,
      kind: org.kind,
    }));
  const items = Object.values(state.items).filter(
    (item) => item.ownerRef?.kind === 'protagonist' && item.ownerRef.id === state.protagonist.id,
  );
  const timeline = state.timeline
    .filter((entry) => isPublicHistory(state,entry))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const visibleLocations = new Set([
    state.protagonist.locationId,
    ...npc.map((p) => p.locationId),
    ...items.map((i) => i.locationId),
    ...events.map((e) => e.locationId),
    ...timeline.map((t) => t.locationId),
  ]);
  for (const id of [...visibleLocations]) {
    let parent = id ? state.locations[id]?.parentId : undefined;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent);
      visibleLocations.add(parent);
      parent = state.locations[parent]?.parentId;
    }
  }
  return {
    npc,
    organizations,
    items,
    locations: Object.values(state.locations).filter((place) => visibleLocations.has(place.id)),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt,
      status: e.status,
      resolutionText: e.resolutionText,
    })),
    timeline: timeline.map((entry) => ({
      eventId: entry.eventId,
      occurredAt: entry.occurredAt,
      title: entry.title,
      summary: entry.summary,
      outcome: entry.outcome,
      longTermImpact: entry.longTermImpact,
      sourceTurnIds: entry.sourceTurnIds,
    })),
    memories: memories.map((memory) => ({
      id: memory.id,
      layer: memory.layer,
      tier: memory.tier,
      origin: memory.origin,
      text: memory.text,
      sourceTurnIds: memory.sourceTurnIds,
      createdAtGameTime: memory.createdAtGameTime,
    })),
    // 即时只是永久正文的只读窗口，不创建MemoryEntry，也不借当前时钟填补旧历史。
    immediateMemories: journal.slice(-effectiveWindowSize).map((entry) => ({ ...entry, createdAtGameTime: turnTimes.get(entry.turnId) })),
    immediateWindowSize: effectiveWindowSize,
    memoryLayers: {
      short: memories.filter((m) => m.tier === 'short').length,
      medium: memories.filter((m) => m.tier === 'medium').length,
      long: memories.filter((m) => m.tier === 'long').length,
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
