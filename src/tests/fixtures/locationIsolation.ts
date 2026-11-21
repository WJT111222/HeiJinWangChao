import type { NPC } from '../../domain/npc/schema';
import { npc } from './game';
import { issue194 } from './issue194';

export const correctPlace = 'jing_an_tan_gong_tingyulou';
export const wrongPlace = 'jing_an_tan_tan_gong_tingyulou';
export const isolationClock = '2026-05-17T13:55:00+08:00';
export const wrapUpdates = (commands: string) =>
  `<thinking>合成检查。</thinking><说明>登记合成变更。</说明><命令>\n${commands}\n</命令>`;
export const assign = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;

export function locationsForIsolation(parent = true) {
  const { state, draft } = issue194();
  state.locations['room-a'] = { id: 'room-a', name: '甲室' };
  state.locations['room-b'] = { id: 'room-b', name: '乙室' };
  if (parent) state.locations['place-parent'] = { id: 'place-parent', name: '样本街区' };
  state.protagonist.locationId = 'room-a';
  for (const person of Object.values(state.npc)) if (person.onScene) person.locationId = 'room-a';
  state.npc['npc-a'] = { ...npc(), name: '人物甲', locationId: 'room-a' };
  const ownerRef = { kind: 'protagonist', id: state.protagonist.id } as const;
  state.items['item-a'] = { id: 'item-a', name: '样本上衣', ownerRef, locationId: 'room-a', category: 'top', quantity: 1, conditionText: '完整' };
  state.items['item-b'] = { id: 'item-b', name: '样本配件', ownerRef, locationId: 'room-a', category: 'accessory', quantity: 1, conditionText: '完整' };
  state.protagonist.currentWear = { topItemId: 'item-a', accessoryItemIds: ['item-b'] };
  return { state, draft };
}

export function specialForIsolation(id: string, locationId: string, onScene: boolean): Extract<NPC, {kind: 'special'}> {
  return { ...npc(id), kind: 'special', name: `样本人 ${id}`, locationId, onScene,
    affinity: 0, detailedBackground: '合成档案', activeGoals: [], habits: [], longTermMemories: [], offscreenTaskIds: [] };
}
export const relationTo = (id: string) => [{ name: `样本人 ${id}`, relationship: '同事', description: '参与整理样本', npcId: id }];
const locationRecord = [{ locationId: correctPlace, role: 'work', knownToProtagonist: true }];
export const isolationNpcIds = ['new-a', 'new-b', 'new-c', 'new-d'] as const;

export function locationIsolationCommands(location = wrongPlace) {
  const createNpcs = isolationNpcIds.map(id => {
    const { id: entityId, ...person } = specialForIsolation(id, correctPlace, true);
    return assign(`npc[${entityId}]`, person);
  });
  const memoryTargets = ['npc-a', ...isolationNpcIds];
  return [
    assign('worldClock', isolationClock),
    assign(`locations[${correctPlace}]`, { name: '合成工作间', parentId: 'place-parent' }),
    assign('protagonist.locationId', correctPlace),
    assign('items[item-a].locationId', location),
    assign('items[item-b].locationId', correctPlace),
    assign('npc[npc-a].locationId', correctPlace),
    assign('npc[npc-a].onScene', true),
    assign('npc[npc-a].lastInteractionAt', isolationClock),
    assign('npc[npc-a].relationshipText', '共同记录样本'),
    assign('npc[npc-a].affinityChange', { to: 35, reason: '协作', relationshipText: '协作关系已建立' }),
    ...createNpcs,
    ...['new-a', 'new-b', 'npc-a'].map(id => assign(`npc[${id}].usualLocations`, locationRecord)),
    assign('npc[new-a].relationshipNetwork', relationTo('new-b')),
    assign('npc[new-b].relationshipNetwork', relationTo('new-a')),
    ...memoryTargets.map(id => `push npc[${id}].memories = ${JSON.stringify({
      text: `合成记忆 ${id}`, knowledgeSource: '样本登记现场', knowledgeKind: 'observed', visibility: 'npc_private',
    })}`),
    'delete protagonist.currentWear.topItemId',
    'delete protagonist.currentWear.accessoryItemIds[0]',
  ];
}

export function mutualOrganization(id: string, other: string) {
  return { id, name: `合成组织 ${id}`, kind: 'civil' as const, description: '', protagonistRelation: '无',
    relationHistory: [], keyNpcIds: [], currentTaskIds: [], activities: [],
    relations: [{ organizationId: other, relation: '合作', description: '共同登记资料' }],
  };
}
