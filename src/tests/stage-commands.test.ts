import { describe, expect, it } from 'vitest';
import { commitCommands, DomainCommandSchema, type DomainCommand } from '../domain/commands';
import { commandsForPhase, stageCommands } from '../domain/stageCommands';
import { textVariableCatalog } from '../executors/variableText/catalog';
import { actionTime, projectedTime, worldState } from './fixtures/world';

describe('三段命令目录', () => {
  it('覆盖正式 Schema 的每个命令', () => {
    expect(new Set(Object.values(stageCommands).flat())).toEqual(
      new Set(DomainCommandSchema.options.map(option => option.shape.type.value)));
  });
  it.each(['entities', 'scene'] as const)('%s 文本协议按阶段和回合装配', phase => {
    for (const mode of ['opening', 'regular'] as const) {
      const catalog = textVariableCatalog(mode, phase);
      const types = commandsForPhase(phase, mode)
        .filter(type => type !== 'RegisterContact' && (mode === 'regular' || type !== 'SetSceneDescription'));
      expect(new Set(catalog.entries.map(entry => entry.commandType))).toEqual(new Set(types));
    }
  });
  it('由场外请求明确选择是否装配 RecordHistory', () => {
    expect(commandsForPhase('offscreen', 'regular')).not.toContain('RecordHistory');
    expect(commandsForPhase('offscreen', 'regular', true)).toContain('RecordHistory');
  });
  it('实体阶段的互动时间依赖现场阶段的合法时钟', () => {
    const state = worldState();
    const interaction: DomainCommand = {
      type: 'UpdateNpc', npcId: 'scene', commandId: 'interaction', evidence: '交谈',
      expectedRevision: state.revision, changes: { lastInteractionAt: actionTime },
    };
    const clock: DomainCommand = {
      type: 'SetWorldClock', commandId: 'clock', evidence: '行动结束', worldClock: projectedTime,
    };
    expect(() => commitCommands(state, 'turn-a', state.revision, [interaction])).toThrow();
    const projected = commitCommands(state, 'turn-a', state.revision, [clock, interaction]);
    expect(projected.npc.scene.lastInteractionAt).toBe(actionTime);
    expect(state.npc.scene.lastInteractionAt).toBeUndefined();
  });
});
