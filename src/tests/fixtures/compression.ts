import { historyState } from './history';
import { gameTime } from './game';
import { MemoryEntrySchema } from '../../domain/memories/schema';
import { GameStateSchema } from '../../domain/state';

// 测试专用正式档案夹具；不用于生产创角。
export function compressionState(layer: 'short' | 'medium' = 'short', count = layer === 'short' ? 31 : 51) {
  const state = historyState(count);
  state.memories[layer] = state.journal.map((entry, index) => MemoryEntrySchema.parse({
    id: `memory-${index + 1}`, text: `已知事实${index + 1}：${entry.story.summary}`,
    sourceTurnIds: [entry.turnId], visibility: 'player_known', createdAtGameTime: gameTime,
    affectedEntityRefs: index === 2 ? [{ kind: 'npc', id: 'npc-a' }] : [],
  }));
  state.npc['npc-a'].identity = '不应发给压缩模型的身份秘密';
  state.npc['npc-a'].memories = [{ id: 'private', text: '不应发给压缩模型的私有调查', sourceTurnIds: [], affectedEntityRefs: [], visibility: 'npc_private', createdAtGameTime: gameTime, knowledgeSource: '私下观察' }];
  return GameStateSchema.parse(state);
}
