import { GameStateSchema } from '../../domain/state';
import { game, npc } from './game';

// 旧 M4 档案夹具：有永久 journal，没有新建的短期记忆。
export function historyState(count = 70) {
  const state = game();
  state.npc['npc-a'] = { ...npc(), name: '陈宁', onScene: false };
  state.journal = Array.from({ length: count }, (_, index) => ({
    turnId: `history-${index + 1}`,
    revision: index + 1,
    story: {
      turnKind: index ? 'regular' as const : 'opening' as const,
      narrative: index === 2
        ? '主角和同事陈宁在社区诊所约定下周三再次见面，并保管一枚蓝色钥匙。'
        : `第 ${index + 1} 回合，主角在河边散步，观察水面。`,
      summary: index === 2 ? '与陈宁约定下周三在社区诊所见面，保管蓝色钥匙。' : `第 ${index + 1} 回合散步。`,
      variableGuide: [],
    },
    relatedActorRefs: index === 2 ? [{ kind: 'npc' as const, id: 'npc-a' }] : [],
  }));
  state.revision = count;
  state.turnNumber = count;
  return GameStateSchema.parse(state);
}
