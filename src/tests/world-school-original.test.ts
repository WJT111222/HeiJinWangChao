import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { orderWorldCommands } from '../services/validation/worldDependencies';
import { projectTurn } from '../domain/turnProjection';
import { original, originalSchoolContext } from './fixtures/worldSchoolOriginalContext';
import { schoolEvidence } from './fixtures/worldChineseFact';

describe('完整原始World响应：不修改输出、不假称已恢复原始存档', () => {
  it('原文夹具与用户提供的JSON字节一致，三条命令和futureEvents完整保留', () => {
    const raw = readFileSync(new URL('./fixtures/world-school-original.json', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe('53dde24077607bf3c9a1dc9552e379001f04591fcd1144145b1cd2a9342d4acb');
    expect(original.taskCommands).toHaveLength(1);
    expect(original.eventCommands).toHaveLength(2);
    expect(original.futureEvents).toEqual([original.eventCommands[1].event]);
    expect(JSON.parse(original.taskCommands[0].evidence)).toEqual(schoolEvidence);
  });

  it('原始响应仅换五字段容器后验证，原文件字节不改', () => {
    const {state,draft,response}=originalSchoolContext(),before=structuredClone(state);
    const result=parseWorld(JSON.stringify(response),state,draft);
    expect(result.taskCommands).toHaveLength(1);expect(result.eventCommands).toHaveLength(2);
    expect(orderWorldCommands([...result.taskCommands,...result.eventCommands]).map(c=>c.commandId))
      .toEqual(['task-cmd-20261020-01','event-cmd-20261020-01','event-cmd-20261020-02']);
    const projected=projectTurn(state,draft,[...result.taskCommands,...result.eventCommands]);
    expect(projected.tasks.task_school_prep_supervision.linkedEventId).toBe('event_supervision_inspection_38th');
    expect(projected.npc).toEqual(state.npc);expect(projected.protagonist).toEqual(state.protagonist);
    expect(state).toEqual(before);
  });
});
