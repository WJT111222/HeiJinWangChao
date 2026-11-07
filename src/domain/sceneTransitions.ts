import type { DomainCommand } from './commands';
import type { GameState } from './state';
import { requireData } from './common';

// 只维护“主角现场”的成员关系，不推断人物移动、行动或认知。
export function maintainSceneTransition(
  before: GameState,
  after: GameState,
  commands: readonly DomainCommand[],
) {
  if (after.protagonist.locationId !== before.protagonist.locationId) {
    for (const old of Object.values(before.npc).filter(person => person.onScene)) {
      const person = after.npc[old.id];
      if (!person) continue;
      const updates = commands.filter((command): command is Extract<DomainCommand, {type: 'UpdateNpc'}> => command.type === 'UpdateNpc' && command.npcId === old.id);
      const explicitlyPresent = updates.some(command => command.changes.onScene === true);
      const movedAlong = person.locationId === after.protagonist.locationId
        && updates.some(command => command.changes.locationId === after.protagonist.locationId);
      if (!explicitlyPresent && !movedAlong) person.onScene = false;
    }
  }
  // 明确入场仍须具有最终合法地点；同批先后顺序不影响结果。
  for (const command of commands) if (command.type === 'UpdateNpc'
    && (command.changes.onScene === true || command.changes.locationId === null)) {
    const person = after.npc[command.npcId];
    if (!person) continue; // 同批合法退场已由RetireNpc的领域约束处理。
    requireData(
      !person.onScene || person.locationId,
      'SCENE_LOCATION',
      `在场 NPC（${command.npcId}）必须有明确地点`,
    );
  }
}
