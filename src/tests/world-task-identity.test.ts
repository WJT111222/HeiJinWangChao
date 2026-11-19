import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { parseWorld } from '../services/validation/aiOutputs';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import type { DomainCommand } from '../domain/commands';
import type { WorldTask } from '../domain/events/schema';
import { AiError } from '../services/ai/errors';
import { SaveRepository } from '../services/storage/saveRepository';
import { parsePartialWorld } from '../services/validation/partialOutputs';
import { worldNormalizationNotes } from '../services/validation/worldSceneWrites';
import { keepTaskIdentity } from '../services/validation/worldTaskIdentity';
import { task } from './fixtures/game';
import { completeDraft, elapsedVariables, submission } from './fixtures/turn';
import { worldState, worldDraft, proof, worldResult, projectedTime } from './fixtures/world';

// #193：既有任务的目标、开始时间、完成条件只差允许的排版变化或时间写法时沿用存档原值；内容确有改写仍拒绝。
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
  it.each([
    ['接盘，并顺手', '接盘， 并顺手'],
    ['结束。开始', '结束。 开始'],
    ['甲；乙', '甲； 乙'],
    ['说明：内容', '说明： 内容'],
    ['成功！继续', '成功！ 继续'],
    ['可以？确认', '可以？ 确认'],
    ['核对：完成', '核对： \u3000 完成'],
  ])('目标与完成条件 %s → %s，只差中文标点后的空格', (original, formatted) => {
    const old = { ...oldTask(), goal: original, completionCondition: original };
    const state = withTask(old);
    const raw = resultWith({ ...old, goal: formatted, completionCondition: formatted, status: 'active' });
    const result = parse(raw, state);
    expect(savedTask(result)).toEqual({ ...old, status: 'active' });
    expect(projectTurn(state, worldDraft(), result.taskCommands).tasks[old.id]).toEqual({ ...old, status: 'active' });
    expect(state.tasks[old.id]).toEqual(old);
  });
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

it('Issue #204 的公开目标原文可通过实际 World 候选校验、正式结算、重载和撤回', async () => {
  // 只使用 Issue 中公开的目标摘录，其余数据均来自合成存档夹具。
  const issueGoal = '…摸底房东与店长谈判低价接盘，并顺手将暗影咨询三十万元品牌战略顾问协议转交财务总监老陈走内部请款审批';
  const old = { ...oldTask(), goal: issueGoal, status: 'active' as const };
  const state = withTask(old);
  const factory = new IDBFactory(), repo = await SaveRepository.open('task-identity-204', factory);
  try {
    await repo.create(state);
    const openingText = '开局经过一分钟。';
    const opening = await completeDraft(repo, { narrative: openingText, variables: await elapsedVariables(repo, openingText, 60) });
    const before = (await repo.commitTurn(submission(opening, '继续核对资料'))).state;
    const draft = await completeDraft(repo);
    const resolution = { at: projectedTime, outcome: 'success' as const, result: '已转交资料', reason: '流程已完成', sourceTurnId: draft.turnId };
    const raw = resultWith({ ...old, goal: issueGoal.replace('接盘，', '接盘， '), status: 'completed', resolution });
    const result = await parsePartialWorld(JSON.stringify(raw), before, draft);
    const completed = { ...old, status: 'completed', resolution };
    expect(result.taskCommands).toHaveLength(1);
    expect(savedTask(result)).toEqual(completed);
    expect(result.settlement).toBeUndefined();
    expect(await repo.load(state.saveId)).toEqual(before);

    const ready = await repo.saveDraft({ ...draft, draftRevision: draft.draftRevision + 1,
      world: { ...draft.world!, candidateRevision: draft.world!.candidateRevision + 1, result } }, draft.draftRevision);
    const commit = submission(ready, '');
    const settled = await repo.commitTurn(commit);
    expect(settled.state.tasks[old.id]).toEqual(completed);
    expect((await repo.commitTurn(commit)).replayed).toBe(true);
    const reopened = await SaveRepository.open('task-identity-204', factory);
    try {
      expect(await reopened.load(state.saveId)).toEqual(settled.state);
      const undone = await reopened.undoTurn({ saveId: state.saveId, expectedRevision: settled.state.revision,
        expectedDraft: settled.draft, operationId: 'undo-task-identity-204' });
      expect(undone.state.tasks[old.id]).toEqual(old);
      expect(undone.state.journal).toEqual(before.journal);
    } finally { reopened.close(); }
  } finally { repo.close(); }
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

describe('新建任务按相同的排版规则查重', () => {
  it.each([
    [goal, '仅对林娇娇、 周曼、 陈露三个高转化主号'],
    ['接盘，并顺手', '接盘， 并顺手'],
  ])('同一行动者、同一目标（%s 只差空格）、同一开始时间 → task_duplicate', (original, formatted) => {
    const old = { ...oldTask(), goal: original };
    const raw = resultWith({ ...old, id: 'task-b', goal: formatted });
    expect(failure(() => parse(raw, withTask(old))).details).toMatchObject({
      worldRule: 'task_duplicate', commandType: 'SaveTask', fieldPath: 'taskCommands.0.task.goal',
    });
  });
  it('目标不同的新任务照常建档', () => {
    expect(() => parse(resultWith({ ...oldTask(), id: 'task-b', goal: '整理周日投放复盘' }))).not.toThrow();
  });
});


const identityDifferences = [
  ['词间空格', '客户 A B', '客户 AB'],
  ['任务内容', '完成合同审核', '完成合同签署'],
  ['带圈序号', '批次①', '批次1'],
  ['换行', '批次\n复核', '批次复核'],
  ['中文标点后的换行', '接盘，并顺手', '接盘，\n并顺手'],
  ['中文标点后的制表符', '接盘，并顺手', '接盘，\t并顺手'],
  ['中文标点前的空格', '接盘，并顺手', '接盘 ，并顺手'],
  ['英文标点后的空格', '接盘,并顺手', '接盘, 并顺手'],
  ['非数字字符宽度', '客户 Ａ', '客户 A'],
] as const;

describe('任务身份保留有含义的空白与字符差异', () => {
  it.each(identityDifferences)('既有任务的%s变化仍由 task_immutable 拒绝', (_label, original, changed) => {
    const old = { ...oldTask(), goal: original, completionCondition: original };
    for (const field of ['goal', 'completionCondition'] as const) {
      const raw = resultWith({ ...old, [field]: changed, status: 'active' });
      expect(failure(() => parse(raw, withTask(old)))).toMatchObject({
        code: 'invalid_output',
        details: { worldRule: 'task_immutable', commandIndex: 0, commandType: 'SaveTask', fieldPath: `taskCommands.0.task.${field}` },
      });
    }
  });

  it.each(identityDifferences)('目标有%s差异的新任务不是重复任务', (_label, original, changed) => {
    const state = withTask({ ...oldTask(), goal: original });
    const result = parse(resultWith({ ...oldTask(), id: 'task-b', goal: changed }), state);
    expect(savedTask(result)).toMatchObject({ id: 'task-b', goal: changed });
    expect(worldNormalizationNotes.get(result)).toBeUndefined();
  });

  it('有任何身份字段不等价时，不提前修正其他字段的写法', () => {
    const old = { ...oldTask(), completionCondition: '批次①' };
    const candidate = { ...old, goal: '仅对林娇娇、 周曼、 陈露三个高转化主号',
      startAt: '2026-10-18T00:00:00+00:00', completionCondition: '批次1' };
    const before = structuredClone(candidate);
    expect(failure(() => keepTaskIdentity(old, candidate)).details).toMatchObject({
      worldRule: 'task_immutable', fieldPath: 'task.completionCondition',
    });
    expect(candidate).toEqual(before);
  });
});
