import type { GameState } from '../../domain/state';

export function playerView(state: GameState) {
  const events = Object.values(state.events).filter((event) => event.visibility === 'known');
  const memories = [
    ...state.memories.short.map((memory) => ({ ...memory, layer: '短期' })),
    ...state.memories.medium.map((memory) => ({ ...memory, layer: '中期' })),
    ...state.memories.long.map((memory) => ({ ...memory, layer: '长期' })),
    ...Object.values(state.memories.npcSummaries)
      .flat()
      .map((memory) => ({ ...memory, layer: '人物摘要' })),
    ...Object.values(state.npc).flatMap((npc) => [
      ...npc.memories.map((memory) => ({ ...memory, layer: '人物记忆' })),
      ...(npc.kind === 'special'
        ? npc.longTermMemories.map((memory) => ({ ...memory, layer: '人物长期记忆' }))
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
      name: person.name,
      kind: person.kind,
      relationshipText: person.relationshipText,
      affinity:
        person.id === state.initialCompanionId && state.turnNumber === 0 ? null : person.affinity,
      // M1 没有字段级公开标记，私有目标、知识、深层背景和场外位置均不传入资料组件。
      locationId: person.onScene ? person.locationId : undefined,
      onScene: person.onScene,
      identity:
        person.id === state.initialCompanionId || person.onScene ? person.identity : undefined,
      profile:
        person.id === state.initialCompanionId && state.turnNumber === 0
          ? {
              age: person.age,
              appearance: person.appearance,
              temperament: person.temperament,
              skills: person.skills,
              background: person.background,
            }
          : undefined,
    }));
  const organizations = Object.values(state.organizations)
    .filter((org) => knownActors.has(`organization:${org.id}`))
    .map((org) => ({
      id: org.id,
      name: org.name,
      kind: org.kind,
      protagonistRelation: org.protagonistRelation,
    }));
  const items = Object.values(state.items).filter(
    (item) => item.ownerRef?.kind === 'protagonist' && item.ownerRef.id === state.protagonist.id,
  );
  const timeline = state.timeline
    .filter((entry) => {
      const event = state.events[entry.eventId];
      return (
        event?.status === 'resolved' && event.impact === 'major' && event.visibility === 'known'
      );
    })
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
      estimatedEndAt: e.estimatedEndAt,
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
      text: memory.text,
      sourceTurnIds: memory.sourceTurnIds,
      createdAtGameTime: memory.createdAtGameTime,
    })),
    immediateWindowSize: state.memories.immediateWindowSize,
    memoryLayers: {
      short: state.memories.short.filter((m) => m.visibility === 'player_known').length,
      medium: state.memories.medium.filter((m) => m.visibility === 'player_known').length,
      long: state.memories.long.filter((m) => m.visibility === 'player_known').length,
    },
    journal: state.journal.map((entry) => ({
      turnId: entry.turnId,
      narrative: entry.story.narrative,
      summary: entry.story.summary,
    })),
  };
}
export type PlayerView = ReturnType<typeof playerView>;
export const money = (value: number | null) =>
  value === null
    ? '未确认'
    : `${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} 元`;
export const dateTime = (time: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
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
