import { createGameState } from '../../domain/state';
import type { DomainCommand } from '../../domain/commands';
import type { NPC } from '../../domain/npc/schema';
import type { Organization } from '../../domain/organizations/schema';
import type { WorldEvent, WorldTask } from '../../domain/events/schema';

export const gameTime = '2026-10-18T08:00:00+08:00';
export function game(saveId = 'save-a') {
  return createGameState({ saveId, title: '测试存档', worldClock: gameTime, cash: 10000, onlineBalance: 20000,
    protagonist: { id: 'hero', name: '林舟', age: 30, gender: '男', appearance: '', personality: '',
      profession: '教师', background: '自由背景', skills: ['教学'], healthText: '健康', emotionText: '平静',
      locationId: 'chongqing', currentWear: { accessoryItemIds: [] } },
    locations: { chongqing: { id: 'chongqing', name: '重庆' } },
  });
}
export function npc(id = 'npc-a'): NPC {
  return { id, identityKey: `identity-${id}`, kind: 'ordinary', name: '同事', aliases: [], skills: [],
    onScene: true, affinity: 30, relationshipText: '工作中相互信任', locationId: 'chongqing',
    memories: [], knownInformation: [] };
}
export function purchase(commandId = 'buy-shirt', price = 2500, itemId = 'shirt'): DomainCommand {
  return { commandId, evidence: '已付款购买上衣', type: 'PurchaseItem', account: 'cash', price,
    item: { id: itemId, name: '上衣', category: 'top', quantity: 1,
      ownerRef: { kind: 'protagonist', id: 'hero' }, conditionText: '完好' } };
}
export function event(id = 'event-a'): WorldEvent {
  return { id, title: '预约', backgroundText: '既有预约安排', goalText: '完成预约事项', status: 'scheduled', startAt: gameTime, estimatedEndAt: gameTime,
    actorRefs: [{ kind: 'protagonist', id: 'hero' }], linkedTaskIds: [], prerequisites: [], blockers: [],
    visibility: 'hidden', impact: 'major', sourceTurnIds: ['turn-a'] };
}
export function task(id = 'task-a'): WorldTask {
  return { id, goal: '参加预约', actorRef: { kind: 'protagonist', id: 'hero' },
    startAt: gameTime, dueAt: gameTime, status: 'planned', prerequisites: [], blockers: [] };
}
export const story = { turnKind: 'regular' as const, narrative: '正文草稿', summary: '摘要', variableGuide: [] };
export const organizationBase = {
  id: 'org-a', name: '相关组织', description: '', protagonistRelation: '曾有一次业务往来',
  relationHistory: ['参与业务咨询'], keyNpcIds: [], currentTaskIds: [],
};
export const organizations: Organization[] = [
  { ...organizationBase, kind: 'gang', industries: [] },
  { ...organizationBase, kind: 'government', lawfulPowers: ['依法履职'], cases: [], administrativeAffairs: [] },
  { ...organizationBase, kind: 'civil', activities: [] },
  { ...organizationBase, kind: 'business', sectors: [], businessRelations: [] },
];
