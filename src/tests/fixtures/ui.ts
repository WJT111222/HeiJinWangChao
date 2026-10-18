// 仅供测试使用；生产入口不导入、不注入此数据。
import { GameStateSchema } from '../../domain/state';
import { game, npc, gameTime, event, organizations, story } from './game';
export function uiFixture() {
  const state = game('ui-test');
  state.title = '界面测试存档（隔离）';
  state.npc['npc-a'] = {
    ...npc(),
    identity: '在场人物内部身份不可见',
    relationshipText: '内部关系判断不可见',
  };
  state.npc.secretNpc = { ...npc('secretNpc'), onScene: false, name: '隐藏人物不可见' };
  state.memories.short = [
    {
      id: 'known-memory',
      text: '已知记忆：一次公开会面',
      sourceTurnIds: ['turn-a'],
      affectedEntityRefs: [],
      visibility: 'player_known',
      createdAtGameTime: gameTime,
    },
    {
      id: 'secret-memory',
      text: '内部记忆不可见',
      sourceTurnIds: [],
      affectedEntityRefs: [],
      visibility: 'internal',
      createdAtGameTime: gameTime,
    },
  ];
  state.npc['npc-a'].memories = [
    {
      id: 'private-memory',
      text: 'NPC私有记忆不可见',
      sourceTurnIds: [],
      affectedEntityRefs: [],
      visibility: 'npc_private',
      createdAtGameTime: gameTime,
      knowledgeSource: '私下观察',
    },
  ];
  state.organizations['org-a'] = {
    ...organizations[1],
    description: '组织内部描述不可见',
    protagonistRelation: '组织内部关系不可见',
  };
  state.locations.secretPlace = { id: 'secretPlace', name: '隐藏地点不可见' };
  state.events.secretEvent = {
    ...event('secretEvent'),
    title: '秘密计划不可见',
    locationId: 'secretPlace',
    visibility: 'hidden',
  };
  state.events.partialEvent = {
    ...event('partialEvent'),
    title: '部分已知事件内部标题不可见',
    visibility: 'partially_known',
  };
  for (const [id, title, date] of [
    ['public-event', '公开会面', '2026-10-17T08:00:00+08:00'],
    ['earlier-event', '更早的公开事件', '2026-10-16T08:00:00+08:00'],
  ]) {
    state.events[id] = {
      ...event(id),
      title,
      startAt: date,
      estimatedEndAt: '2099-12-31T23:00:00+08:00',
      resolvedAt: date,
      status: 'resolved',
      resolutionText: '已公开结案',
      visibility: 'known',
      actorRefs: [{ kind: 'organization', id: 'org-a' }],
    };
    state.timeline.push({
      eventId: id,
      occurredAt: date,
      title,
      summary: '公开记录',
      outcome: '结案',
      longTermImpact: '已知后果',
      sourceTurnIds: ['turn-a'],
      actorRefs: [],
    });
  }
  state.turnNumber = 1;
  state.revision = 1;
  state.journal = [
    {
      turnId: 'turn-a',
      revision: 1,
      story: { ...story, narrative: '这是隔离测试用正文。\n'.repeat(150), summary: '公开正文记录' },
      relatedActorRefs: [],
    },
  ];
  return GameStateSchema.parse(state);
}
