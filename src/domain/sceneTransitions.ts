import type { DomainCommand } from './commands';
import type { GameState } from './state';
import { requireData } from './common';

// 只检查显式场景状态处理。是否同行/留守由变量AI理解剧情，不用中文正则判案。
export function validateSceneTransition(
  before: GameState,
  after: GameState,
  commands: readonly DomainCommand[],
) {
  // 入场和显式清除地点按整批最终状态检查，避免合法分步更新被指令顺序阻断。
  for (const command of commands) if (command.type === 'UpdateNpc'
    && (command.changes.onScene === true || command.changes.locationId === null)) {
    const person = after.npc[command.npcId];
    if (!person) continue; // 同批合法退场已由RetireNpc的领域约束处理。
    requireData(!person.onScene || person.locationId, 'SCENE_LOCATION', '在场 NPC 必须有明确地点');
  }
  if (after.protagonist.locationId === before.protagonist.locationId) return;
  for (const npc of Object.values(before.npc).filter((person) => person.onScene)) {
    const updates = commands
      .filter((command) => command.type === 'UpdateNpc')
      .filter((command) => command.npcId === npc.id);
    requireData(
      updates.some((command) => command.changes.onScene !== undefined || command.changes.locationId !== undefined),
      'SCENE_TRANSITION',
      '主角移动时须显式更新原在场 NPC 的地点或在场状态，不自动跟随',
    );
    // 归属、合法地点和onScene与主角位置一致性由GameStateSchema统一校验。
  }
}
