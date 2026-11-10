import { GameStateSchema } from '../../domain/state';
import { game, npc } from './game';

export function npcV2State() {
  const state = game();
  state.locations.home = { id: 'home', name: '测试住宅', parentId: 'chongqing' };
  state.locations.office = { id: 'office', name: '测试工作室', parentId: 'chongqing' };
  state.npc.person = { ...npc('person'), name: '林澄', onScene: false,
    phoneContact: { status: 'unknown' }, usualLocations: [
      { locationId: 'home', role: 'home', knownToProtagonist: false },
      { locationId: 'office', role: 'work', knownToProtagonist: true },
    ] };
  state.npc.special = { ...npc('special'), name: '许岸', onScene: false, kind: 'special',
    age: 30, gender: 'female', detailedBackground: '专属经历封存标记-A7',
    activeGoals: ['专属目标封存标记-B8'], habits: ['专属习惯封存标记-C9'],
    longTermMemories: [], offscreenTaskIds: [], privateProfile: { bodyDescription: '专属私密封存标记-D0' },
    relationshipNetwork: [
      { name: '林澄', npcId: 'person', relationship: '同行', description: '相识于工作室', affinity: -12 },
      { name: '未建档的旧同学', relationship: '同学', description: '偶尔通信', affinity: null },
    ], phoneContact: { status: 'known', note: '可通过工作室电话转接' },
  };
  return GameStateSchema.parse(state);
}
