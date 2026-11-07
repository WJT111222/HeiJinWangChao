import { describe, expect, it } from 'vitest';
import type { DomainCommand } from '../domain/commands';
import type { WorldEvent, WorldTask } from '../domain/events/schema';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { parseWorld } from '../services/validation/aiOutputs';
import type { LegacyWorldEvidence as WorldEvidence } from './fixtures/world';
import { npc, task, event, organizations } from './fixtures/game';
import { worldState, worldDraft, worldResult, proof, actionTime } from './fixtures/world';

const npcActor = { kind: 'npc' as const, id: 'npc-a' };
const future = '2026-10-18T09:00:00+08:00';
const earlierEstimate = '2026-10-18T08:02:00+08:00';
function job(id = 'task-a', status: WorldTask['status'] = 'planned'): WorldTask {
  return { ...task(id), actorRef: npcActor, goal: `器材清点 ${id}`, status, dueAt: future };
}
function incident(id = 'event-a'): WorldEvent {
  return {
    ...event(id),
    title: `器材整理 ${id}`,
    actorRefs: [npcActor],
    estimatedEndAt: earlierEstimate,
  };
}
function taskCommand(
  value = job(),
  options: Partial<WorldEvidence> = {},
): Extract<DomainCommand, { type: 'SaveTask' }> {
  return {
    type: 'SaveTask',
    commandId: `save-${value.id}`,
    task: ['completed','cancelled'].includes(value.status) && !value.resolution ? {...value,resolution:{at:options.at ?? actionTime,outcome:value.status==='completed'?'success':'cancelled',result:options.outcome ?? '本次工作结束',reason:'本次排程结束',sourceTurnId:'turn-a'}} : value,
    evidence: proof({ kind: value.status === 'planned' ? 'planned' : 'derived', ...options }),
  };
}
function eventCommand(
  value = incident(),
  options: Partial<WorldEvidence> = {},
): Extract<DomainCommand, { type: 'SaveEvent' }> {
  return {
    type: 'SaveEvent',
    commandId: `save-${value.id}`,
    event: value,
    evidence: proof({ kind: value.status === 'scheduled' ? 'planned' : 'derived', ...options }),
  };
}
function stateWith(tasks: WorldTask[] = [], events: WorldEvent[] = []) {
  return GameStateSchema.parse({
    ...worldState(),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    events: Object.fromEntries(events.map((e) => [e.id, e])),
  });
}
function parse(result = worldResult(), state = worldState(), draft = worldDraft()) {
  return parseWorld(JSON.stringify(result), state, draft);
}
function withTasks(commands: DomainCommand[]) {
  return { ...worldResult(), taskCommands: commands };
}
function withEvents(commands: DomainCommand[]) {
  return { ...worldResult(), eventCommands: commands };
}
const completion = { outcome: '诊疗器材逐件核对归位，清点结果已记录并可追溯。' };

describe('二轮 A1 地点建档只接受存在事实', () => {
  const location: Extract<DomainCommand, { type: 'CreateLocation' }> = {
    type: 'CreateLocation',
    commandId: 'warehouse',
    location: { id: 'warehouse', name: '城南仓库', parentId: 'chongqing' },
    evidence: proof(),
  };
  it('正文已确认存在的地点可以建档', () => {
    const draft = worldDraft(),
      fact = '城南仓库已经建成并投入使用。';
    draft.story!.narrative += fact;
    expect(
      parse(
        worldResult([
          {
            ...location,
            evidence: proof({ kind: 'established', sources: ['story:current'], fact }),
          },
        ]),
        worldState(),
        draft,
      ),
    ).toBeDefined();
  });
  it('当轮场外推演可补录此前未建档但实际存在的地点，无需正文逐字预告', () => {
    const c = {
      ...location,
      evidence: proof({
        fact: '同事在值班路线核对了现有城南仓库的位置。',
        rationale: '已有工作动机，五分钟内核对已存在建筑，不是五分钟内修建仓库。',
      }),
    };
    expect(parse(worldResult([c]))).toBeDefined();
  });
  it.each(['missing', 'warehouse', 'chongqing'])('非法父级或重复 ID %s 继续拒绝', (value) => {
    const c =
      value === 'chongqing'
        ? { ...location, location: { ...location.location, id: 'chongqing' } }
        : { ...location, location: { ...location.location, parentId: value } };
    expect(() => parse(worldResult([c]))).toThrow();
  });
});

describe('二轮 A2 预计时间与实际结案相互独立', () => {
  it('新未来事件允许自主估计 estimatedEndAt，futureEvents 保留同一镜像', () => {
    const e = { ...incident(), startAt: future, estimatedEndAt: '2026-10-18T10:30:00+08:00' };
    expect(parse(withEvents([eventCommand(e)])).eventCommands.map(c=>c.type==='SaveEvent'?c.event.estimatedEndAt:undefined)[0]).toBe(
      e.estimatedEndAt,
    );
  });
  it.each(['scheduled', 'active', 'blocked'] as const)(
    '%s 不允许提前存 resolvedAt/resolutionText，包括空串',
    (status) => {
      const e = { ...incident(), status };
      for (const fields of [
        { resolvedAt: actionTime },
        { resolutionText: '成功完成' },
        { resolutionText: '' },
        { resolvedAt: actionTime, resolutionText: '失败结束' },
      ]) {
        expect(() => parse(withEvents([eventCommand({ ...e, ...fields })]))).toThrow();
      }
    },
  );
  it('futureEvents 的完全相同镜像也不能绕过 scheduled 结案字段检查', () => {
    const e = {
      ...incident(),
      startAt: future,
      estimatedEndAt: '2026-10-18T10:00:00+08:00',
      resolutionText: '行动成功',
    };
    expect(() => parse(withEvents([eventCommand(e)]))).toThrow();
    const closed = { ...e, resolvedAt: future };
    expect(() => parse(withEvents([eventCommand(closed)]))).toThrow();
  });
  it('超过预计时间仍可继续 active、更新估计；到期不等于 resolved', () => {
    const old = { ...incident(), status: 'active' as const },
      state = stateWith([], [old]);
    const ongoing = { ...old, estimatedEndAt: future };
    const accepted = parse(
      withEvents([
        eventCommand(ongoing, {
          sources: ['event:event-a', 'goal:npc-a:0'],
          fact: '同事仍在逐件清点器材。',
          rationale: '发现清单条目多于此前估计，工作继续，预计延后。',
        }),
      ]),
      state,
    );
    expect(accepted.eventCommands[0]).toMatchObject({
      event: { status: 'active', estimatedEndAt: future },
    });
    expect(state.events['event-a']).toEqual(old);
    expect(() =>
      parse(
        withEvents([
          eventCommand(
            { ...old, status: 'resolved', resolvedAt: actionTime },
            { sources: ['event:event-a', 'goal:npc-a:0'], outcome: '任务已到期' },
          ),
        ]),
        state,
      ),
    ).toThrow();
  });
  it('实际合法结案晚于原估计；来源和具体成果仍须通过，正式状态不变', () => {
    const old = incident(),
      state = stateWith([], [old]),
      before = structuredClone(state);
    const closed = {
      ...old,
      status: 'resolved' as const,
      resolvedAt: actionTime,
      resolutionText: '逐件复核后结束，器材清单一致',
    };
    expect(Date.parse(closed.resolvedAt)).toBeGreaterThan(Date.parse(old.estimatedEndAt!));
    const result = parse(
      withEvents([
        eventCommand(closed, { sources: ['event:event-a', 'goal:npc-a:0'], ...completion }),
      ]),
      state,
    );
    expect(result.eventCommands[0]).toMatchObject({ event: closed });
    expect(state).toEqual(before);
  });
  it.each(['explanation', 'time', 'neither'] as const)(
    '兼容合法 cancelled 的 %s 字段组合',
    (mode) => {
      const old = incident(),
        state = stateWith([], [old]);
      const cancelled = {
        ...old,
        status: 'cancelled' as const,
        ...(mode === 'explanation'
          ? { resolutionText: '设备故障，已取消整理安排' }
          : mode === 'time'
            ? { resolvedAt: actionTime }
            : {}),
      };
      expect(
        parse(
          withEvents([
            eventCommand(cancelled, {
              sources: ['event:event-a', 'goal:npc-a:0'],
              fact: '同事因设备故障取消了器材整理安排。',
              outcome: '器材电路损坏导致安全条件不满足，负责人撤销排程。',
            }),
          ]),
          state,
        ),
      ).toBeDefined();
    },
  );
  it('未来排程可在开始前取消且保留说明，不强制伪造 resolvedAt', () => {
    const old = { ...incident(), startAt: future, estimatedEndAt: '2026-10-18T10:00:00+08:00' },
      state = stateWith([], [old]);
    const c = { ...old, status: 'cancelled' as const, resolutionText: '安排冲突，筹备已经终止' };
    expect(
      parse(
        withEvents([
          eventCommand(c, {
            sources: ['event:event-a', 'goal:npc-a:0'],
            fact: '同事取消了该项筹备安排。',
            outcome: '场地无法按期开放，筹备人员撤回，原排程不再执行。',
          }),
        ]),
        state,
      ),
    ).toBeDefined();
    expect(() =>
      parse(withEvents([eventCommand({ ...c, resolvedAt: '2026-10-18T10:00:00+08:00' })]), state),
    ).toThrow();
  });
});

describe('多任务并行、终态和归属边界', () => {
  it.each(['planned','active','blocked'] as const)('已有%s时可增加独立未来职责',status=>{
 const state=stateWith([job('old',status)]),before=structuredClone(state),next={...job('new'),startAt:future,dueAt:'2026-10-18T10:00:00+08:00'};
 expect(parse(withTasks([taskCommand(next)]),state).taskCommands).toHaveLength(1);expect(state).toEqual(before);
});
  it.each(['completed', 'cancelled'] as const)(
    '历史 %s 不占用名额，可在后续世界推演新增任务',
    (status) => {
      const state = stateWith([job('old', status)]);
      expect(parse(withTasks([taskCommand(job('new'))]), state).taskCommands).toHaveLength(1);
    },
  );
  it('同批两个新任务可共存：不同 ID、顺序、当前/未来时间均合法', () => {
    const a = taskCommand(job('a')),
      b = taskCommand({ ...job('b'), startAt: future, dueAt: '2026-10-18T10:00:00+08:00' });
    for (const commands of [
      [a, b],
      [b, a],
    ])
      expect(() => parse(withTasks(commands))).not.toThrow();
  });
  it('不同 NPC 各自一项任务允许', () => {
    const state = worldState();
    state.npc.other = { ...npc('other'), name: '另一人物', onScene: false };
    const a = taskCommand(job('a')),
      b = taskCommand(
        { ...job('b'), actorRef: { kind: 'npc', id: 'other' } },
        { sources: ['npc:other'] },
      );
    expect(parse(withTasks([a, b]), state).taskCommands).toHaveLength(2);
  });
  it('组织可以拥有多个独立任务，不实施一组织一任务', () => {
    const state = worldState();
    state.organizations['org-a'] = organizations[2];
    const commands = ['a', 'b'].map((id) =>
      taskCommand(
        { ...job(id), actorRef: { kind: 'organization', id: 'org-a' } },
        { sources: ['org:org-a'] },
      ),
    );
    expect(parse(withTasks(commands), state).taskCommands).toHaveLength(2);
  });
  it('任务不能改派给其他 NPC 或组织来规避占用', () => {
    const old = job(),
      state = stateWith([old]);
    state.npc.other = { ...npc('other'), onScene: false };
    state.organizations['org-a'] = organizations[2];
    for (const actorRef of [
      { kind: 'npc' as const, id: 'other' },
      { kind: 'organization' as const, id: 'org-a' },
    ]) {
      expect(() => parse(withTasks([taskCommand({ ...old, actorRef })]), state)).toThrow();
    }
  });
  it.each(['completed', 'cancelled'] as const)(
    '同批先 %s 旧任务再新增任务，两种顺序均允许',
    (status) => {
      const old = job(),
        state = stateWith([old]);
      const end = taskCommand(
          { ...old, status },
          {
            sources: ['task:task-a', 'goal:npc-a:0'],
            ...(status === 'cancelled'
              ? {
                  fact: '同事因器材损坏取消了清点安排。',
                  outcome: '关键器材损坏，原排程撤销，现场工作停止。',
                }
              : completion),
          },
        ),
        next = taskCommand(job('next'));
      for (const commands of [
        [end, next],
        [next, end],
      ])
        expect(() => parse(withTasks(commands), state)).not.toThrow();
    },
  );
  it('本批新建并完成 A 也可接力新增 B', () => {
    const end = taskCommand({ ...job('temporary'), status: 'completed' }, completion),
      next = taskCommand(job('next'));
    expect(() => parse(withTasks([end, next]))).not.toThrow();
  });
  it('变量候选已终结但尚未正式提交时，投影与正式复核使用相同多任务规则', () => {
    const old = job(),
      state = stateWith([old]),
      draft = worldDraft();
    // 变量阶段通过电话接收结果，仍不等于正式提交。
    const fact = '主角通过电话得知同事已经完成器材清点。';
    draft.story!.narrative += fact;
    draft.variables!.result.commands.push({
      type: 'SaveTask',
      commandId: 'var-complete',
      task: { ...old, status: 'completed' },
      evidence: fact,
    });
    expect(() => parse(withTasks([taskCommand(job('next'))]), state, draft)).not.toThrow();
  });
  it('变量投影新增的未终结任务不阻止其他独立任务', () => {
    const state = worldState(),
      draft = worldDraft(),
      fact = '主角在电话中确认同事已经接下清点任务。';
    draft.story!.narrative += fact;
    draft.variables!.result.commands.push({
      type: 'SaveTask',
      commandId: 'var-task',
      task: job('var-task'),
      evidence: fact,
    });
    expect(() => parse(withTasks([taskCommand(job('next'))]), state, draft)).not.toThrow();
  });
  it('并行任务不生成冲突告警、不自动清理，正常继续追加',()=>{
 const state=stateWith([job('a'),job('b','blocked')]),before=structuredClone(state);
 expect(parse(worldResult(),state).unresolved).toEqual(worldResult().unresolved);
 expect(parse(withTasks([taskCommand(job('new'))]),state).taskCommands).toHaveLength(1);expect(state).toEqual(before);
});
});

describe('二轮 A4/A5 完成来源与失败终止语义', () => {
  it('世界更新不能继承变量投影中的改派来绕过正式任务行动者', () => {
    const old = job(),
      state = stateWith([old]),
      draft = worldDraft();
    state.organizations['org-a'] = organizations[2];
    const assigned = { ...old, actorRef: { kind: 'organization' as const, id: 'org-a' } },
      fact = '同事把清点任务交给相关组织，由该组织接管任务。';
    draft.story!.narrative += fact;
    draft.variables!.result.commands.push({
      type: 'SaveTask',
      commandId: 'reassigned',
      task: assigned,
      evidence: fact,
    });
    expect(() =>
      parse(
        withTasks([
          taskCommand(
            { ...assigned, status: 'completed' },
            { sources: ['task:task-a', 'org:org-a'], ...completion },
          ),
        ]),
        state,
        draft,
      ),
    ).toThrow();
  });
  it('resolved 的实际结案描述不能是空白', () => {
    const old = incident(),
      state = stateWith([], [old]);
    expect(() =>
      parse(
        withEvents([
          eventCommand(
            { ...old, status: 'resolved', resolvedAt: actionTime, resolutionText: '  ' },
            { sources: ['event:event-a', 'goal:npc-a:0'], ...completion },
          ),
        ]),
        state,
      ),
    ).toThrow();
  });
  it('有自身 task 来源和动机时可自主完成，正文无需预先证明新结果', () => {
    const old = job(),
      state = stateWith([old]),
      before = structuredClone(state);
    const r = withTasks([
      taskCommand(
        { ...old, status: 'completed' },
        {
          sources: ['task:task-a', 'goal:npc-a:0'],
          fact: '同事逐件完成了器材清点。',
          ...completion,
        },
      ),
    ]);
    expect(worldDraft().story!.narrative).not.toContain('器材清点');
    const accepted = parse(r, state);
    expect(accepted.taskCommands).toMatchObject(r.taskCommands);
    expect(accepted.taskCommands[0]).toMatchObject({ task: { resolution: { result: completion.outcome, sourceTurnId: 'turn-a' } } });
    expect(state).toEqual(before);
  });
  it('自身来源不允许跳过旧阻碍、删除条件、换目标或伪造截止成功', () => {
    const old = { ...job(), completionCondition: '全部核对签名', blockers: ['缺少钥匙'] },
      state = stateWith([old]);
    for (const patch of [
      { blockers: [] },
      { completionCondition: undefined },
      { goal: '已完成的另一个目标' },
    ])
      expect(() =>
        parse(
          withTasks([
            taskCommand(
              { ...old, status: 'completed', ...patch },
              { sources: ['task:task-a', 'goal:npc-a:0'], ...completion },
            ),
          ]),
          state,
        ),
      ).toThrow();
  });
  it('失败且终止用 cancelled 保存真实原因与结果；blocked 不是成功但不占唯一名额', () => {
    const old = job(),
      state = stateWith([old]);
    const failed = taskCommand(
      { ...old, status: 'cancelled' },
      {
        sources: ['task:task-a', 'goal:npc-a:0'],
        fact: '同事遭遇器材故障，清点行动终止。',
        outcome: '器材故障导致清点失败，行动撤销，已有检查结果保留。',
      },
    );
    const accepted = parse(withTasks([failed]), state);
    expect(accepted.taskCommands[0]).toMatchObject({ task: { status: 'cancelled' } });
    expect(JSON.parse(accepted.taskCommands[0].evidence).outcome).toContain('失败');
    const blocked = taskCommand(
      { ...old, status: 'blocked', blockers: ['器材故障'] },
      { sources: ['task:task-a', 'goal:npc-a:0'], fact: '同事的清点行动遭遇器材故障而暂停。' },
    );
    expect(parse(withTasks([blocked]), state).taskCommands[0]).toMatchObject({
      task: { status: 'blocked' },
    });
    expect(() => parse(withTasks([blocked, taskCommand(job('next'))]), state)).not.toThrow();
    const projected = projectTurn(state, worldDraft(), accepted.taskCommands);
    expect(projected.tasks['task-a'].status).toBe('cancelled');
    expect(state.tasks['task-a'].status).toBe('planned');
  });
});

describe('A5 取消证据定点回归', () => {
  const stopFact = '同事因场地封闭终止了原定的器材清点行动。';
  const stopOutcome = '场地封闭导致器材无法进入，负责人撤销了原排程。';
  function proposal(kind: 'task' | 'event', options: Partial<WorldEvidence>, futureStart = false) {
    const t = {
      ...job(),
      ...(futureStart ? { startAt: future, dueAt: '2026-10-18T10:00:00+08:00' } : {}),
    };
    const e = {
      ...incident(),
      ...(futureStart ? { startAt: future, estimatedEndAt: '2026-10-18T10:00:00+08:00' } : {}),
    };
    const result =
      kind === 'task'
        ? withTasks([taskCommand({ ...t, status: 'cancelled' }, options)])
        : withEvents([eventCommand({ ...e, status: 'cancelled' }, options)]);
    return { result, state: stateWith(kind === 'task' ? [t] : [], kind === 'event' ? [e] : []) };
  }
  it.each(['task', 'event'] as const)('%s 合理取消未来安排，无需满足开始时间或完成条件', (kind) => {
    const p = proposal(
      kind,
      { sources: [`${kind}:${kind}-a`, 'goal:npc-a:0'], fact: stopFact, outcome: stopOutcome },
      true,
    );
    const result = parse(p.result, p.state);
    expect(result).toMatchObject(p.result);
    const command = kind === 'task' ? result.taskCommands[0] : result.eventCommands[0];
    expect(command).toMatchObject(
      kind === 'task' ? { task: { status: 'cancelled' } } : { event: { status: 'cancelled' } },
    );
    if (command.type === 'SaveEvent') {
      expect(command.event.resolvedAt).toBeUndefined();
      expect(command.event.resolutionText).toBeUndefined();
    }
  });
});
