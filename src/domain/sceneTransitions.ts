import type { DomainCommand } from './commands';
import type { GameState } from './state';
import { requireData } from './common';

// 只检查显式场景状态处理。是否同行/留守由变量AI理解剧情，不用中文正则判案。
export function validateSceneTransition(
  before: GameState,
  after: GameState,
  commands: readonly DomainCommand[],
) {
  if (after.protagonist.locationId === before.protagonist.locationId) return;
  for (const npc of Object.values(before.npc).filter((person) => person.onScene)) {
    const updates = commands
      .filter((command) => command.type === 'UpdateNpc')
      .filter((command) => command.npcId === npc.id);
    requireData(
      updates.some((command) => command.changes.onScene !== undefined),
      'SCENE_TRANSITION',
      '主角移动时必须依据正文明确处理每个原在场 NPC，不自动跟随',
    );
    // 归属、合法地点和onScene与主角位置一致性由GameStateSchema统一校验。
  }
}
