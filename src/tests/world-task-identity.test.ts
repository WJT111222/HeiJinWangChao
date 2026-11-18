import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import type { DomainCommand } from '../domain/commands';
import type { WorldTask } from '../domain/events/schema';
import { AiError } from '../services/ai/errors';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';
import { task } from './fixtures/game';
import { worldState, worldDraft, proof, worldResult, projectedTime } from './fixtures/world';

// #193：既有任务的目标、开始时间、完成条件只差空白、全半角或时间写法时沿用存档原值；内容确有改写仍拒绝。
const actor = { kind: 'npc' as const, id: 'npc-a' };
const goal = '仅对林娇娇、周曼、陈露三个高转化主号';
function oldTask(): WorldTask {
  return { ...task(), actorRef: actor, goal, completionCondition: '完成3份投放报告', dueAt: projectedTime };
}
function withTask(value = oldTask()) {
  return GameStateSchema.parse({ ...worldState(), tasks: { [value.id]: value } });
}
function saveTask(value: WorldTask): DomainCommand {
  return { type: 'SaveTask', commandId: 'save-task', task: value, evidence: proof() };
}
function resultWith(value: WorldTask) {
  const r = worldResult();
  r.taskCommands = [saveTask(value)];
  return r;
}
function parse(raw: unknown, state = withTask()) {
  return parseWorld(JSON.stringify(raw), state, worldDraft());
}
function failure(fn: () => unknown) {
  try { fn(); } catch (error) { expect(error).toBeInstanceOf(AiError); return error as AiError; }
  throw Error('expected rejection');
}
const savedTask = (result: ReturnType<typeof parse>) => (result.taskCommands[0] as Extract<DomainCommand, { type: 'SaveTask' }>).task;

describe('既有任务身份字段：只差写法时沿用存档原值', () => {
  it('goal 只多了空格（issue #193 原始复现）：接受状态变化，目标沿用存档原值，并记录处理说明', () => {
    const state = withTask(), raw = resultWith({ ...oldTask(), goal: '仅对林娇娇、 周曼、 陈露三个高转化主号', status: 'active' });
    const before = structuredClone(raw), result = parse(raw, state);
    expect(raw).toEqual(before);
    expect(savedTask(result)).toMatchObject({ goal, status: 'active' });
    expect(worldNormalizationNotes.get(result)?.join('')).toMatch(/SaveTask（task-a）：目标.*沿用存档原值/);
    const projected = projectTurn(state, worldDraft(), result.taskCommands);
    expect(projected.tasks['task-a']).toMatchObject({ goal, status: 'active' });
  });
  it('完成条件只差全角数字、开始时间只是同一时刻的另一种时区写法：一并沿用原值', () => {
    const old = oldTask();
    const result = parse(resultWith({ ...old, completionCondition: '完成３份投放报告', startAt: '2026-10-18T00:00:00+00:00', status: 'active' }));
    expect(savedTask(result)).toMatchObject({ completionCondition: old.completionCondition, startAt: old.startAt, status: 'active' });
    expect(worldNormalizationNotes.get(result)?.join('')).toMatch(/开始时间、完成条件/);
  });
  it('逐字一致时不改写、不记录说明；处理后的结果再次校验（提交前重验）不再产生说明', () => {
    const exact = parse(resultWith({ ...oldTask(), status: 'active' }));
    expect(worldNormalizationNotes.get(exact)).toBeUndefined();
    const normalized = parse(resultWith({ ...oldTask(), goal: ` ${goal} `, status: 'active' }));
    const again = parse(normalized);
    expect(again).toEqual(normalized);
    expect(worldNormalizationNotes.get(again)).toBeUndefined();
  });
});

describe('既有任务身份字段：内容确有改写仍拒绝，并给出独立规则名', () => {
  it.each([
    ['goal', { goal: '改换成另一个目标' }],
    ['completionCondition', { completionCondition: '完成5份投放报告' }],
    ['completionCondition', { completionCondition: undefined }],
    ['startAt', { startAt: '2026-10-18T08:05:00+08:00' }],
  ] as const)('%s 改写 → task_immutable', (field, patch) => {
    const raw = resultWith({ ...oldTask(), ...patch, status: 'active' });
    const before = structuredClone(raw);
    expect(failure(() => parse(raw)).details).toMatchObject({
      worldRule: 'task_immutable', commandType: 'SaveTask', fieldPath: `taskCommands.0.task.${field}`,
    });
    expect(raw).toEqual(before);
  });
});

describe('新建任务查重忽略空白与全半角', () => {
  it('同一行动者、同一目标（只差空格）、同一开始时间 → task_duplicate', () => {
    const raw = resultWith({ ...oldTask(), id: 'task-b', goal: '仅对林娇娇、 周曼、 陈露三个高转化主号' });
    expect(failure(() => parse(raw)).details).toMatchObject({
      worldRule: 'task_duplicate', commandType: 'SaveTask', fieldPath: 'taskCommands.0.task.goal',
    });
  });
  it('目标不同的新任务照常建档', () => {
    expect(() => parse(resultWith({ ...oldTask(), id: 'task-b', goal: '整理周日投放复盘' }))).not.toThrow();
  });
});
