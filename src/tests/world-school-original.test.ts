import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { readWorldEvidence, worldSources } from '../services/validation/worldEvidence';
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

  it('原始第一条任务 evidence 通过正确的来源/时态校验，无需改变原始文本', () => {
    const { state, draft, response } = originalSchoolContext();
    const sources = worldSources(projectTurn(state, draft), draft, state);
    const checked = readWorldEvidence(response.taskCommands[0], sources, state.worldClock, schoolEvidence.at);
    expect(checked.proof.fact).toBe(schoolEvidence.fact);
    expect(orderWorldCommands([...response.taskCommands, ...response.eventCommands]).map(c => c.commandId))
      .toEqual(['task-cmd-20261020-01', 'event-cmd-20261020-01', 'event-cmd-20261020-02']);
  });

  it('领域内存模拟确认关联引用和futureEvents镜像完整，但不冒充World权限验证成功', () => {
    const { state, draft, response } = originalSchoolContext(), before = structuredClone(state);
    const projection = projectTurn(state, draft, [...response.taskCommands, ...response.eventCommands]);
    expect(projection.tasks.task_school_prep_supervision.linkedEventId).toBe('event_supervision_inspection_38th');
    expect(projection.events.event_supervision_inspection_38th.linkedTaskIds).toEqual(['task_school_prep_supervision']);
    expect(response.futureEvents).toEqual([projection.events.event_supervision_inspection_38th]);
    expect(() => parseWorld(JSON.stringify(original), state, draft)).toThrow();
    expect(state).toEqual(before);
  });

  it('完整原文在合成现场状态下仍拒绝第一条SaveEvent的现场NPC越权，正式状态不变', () => {
    const { state, draft } = originalSchoolContext(), before = structuredClone(state);
    expect(() => parseWorld(JSON.stringify(original), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      fieldPath: 'eventCommands.0', commandType: 'SaveEvent', worldRule: 'actor_permission',
    }) }));
    expect(state).toEqual(before);
  });

  it('单独隔离后续事件：本幕实际获知的planned只授予安排消息，不授予未来结果', () => {
    const { state, draft, response } = originalSchoolContext();
    // Only isolate a subset for diagnosis; the canonical fixture above remains byte-identical.
    const isolated = { ...response, eventCommands: [response.eventCommands[1]] };
    const learned = parseWorld(JSON.stringify(isolated), state, draft);
    expect(learned.eventCommands[0]).toMatchObject({event:{status:'scheduled',protagonistKnowledge:{knowledgeKind:'reported',notice:JSON.parse(response.eventCommands[1].evidence).fact}}});
    expect(learned.eventCommands[0]).not.toHaveProperty('event.protagonistKnowledge.startAt');
    const sources = worldSources(projectTurn(state, draft), draft, state);
    expect(readWorldEvidence(response.eventCommands[1], sources, state.worldClock, schoolEvidence.at).proof.kind).toBe('planned');
  });

  it('缺少现场描述来源时，即使NPC离场，也不能仅凭主角参与者引用取得记录权限', () => {
    const { state, draft } = originalSchoolContext(false), before = structuredClone(state);
    expect(() => parseWorld(JSON.stringify(original), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      fieldPath: 'eventCommands.0', commandType: 'SaveEvent', worldRule: 'actor_permission',
    }) }));
    expect(state).toEqual(before);
  });
});
