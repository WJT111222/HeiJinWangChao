import { commitCommands, DomainCommandSchema } from '../../domain/commands';
import { game, npc } from './game';

export const joinFamily = (id: string, to: number) => ({
  op: 'join',
  npcId: id,
  identityKey: 'identity-' + id,
  to,
  reason: '双方决定以家庭成员身份共同生活',
});
export function householdFixture(count = 12) {
  const state = game();
  const changes: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const id = 'family-' + i;
    state.npc[id] = {
      ...npc(id),
      age: 28 + i,
      gender: 'female',
      name: i === 4 || i === 5 ? '林宁' : '合成成员' + (i + 1),
      identity: '合成人物履历 ' + i,
    };
    changes.push(joinFamily(id, i === 0 ? 100 : Math.max(0, 95 - i)));
  }
  if (!count) return state;
  changes.push({
    op: 'pregnancy',
    npcId: 'family-0',
    reason: '已知家庭记录',
    value: { status: 'confirmed', visibility: 'player_known' },
  });
  return commitCommands(
    state,
    'family-fixture',
    state.revision,
    [
      DomainCommandSchema.parse({
        type: 'ApplyHaremChanges',
        commandId: 'family',
        evidence: '已确认事实',
        expectedRevision: state.revision,
        changes,
      }),
    ],
    state.updatedAt,
  );
}
