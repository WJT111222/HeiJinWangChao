import { history } from './fixtures/historyRecord';
import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { WorldResultSchema, TurnDraftSchema } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import type { WorldTask, WorldEvent } from '../domain/events/schema';
import { composePrompt } from '../prompts/composer';
import { selectWorldDomains } from '../prompts/worldDomains';
import { defaultSettings } from '../ui/settings/model';
import { npc, task, event, organizations, gameTime } from './fixtures/game';
import {
  worldState,
  worldDraft,
  npcUpdate,
  proof,
  worldResult,
  actionTime,
  projectedTime,
} from './fixtures/world';
function parse(result = worldResult(), state = worldState(), draft = worldDraft()) {
  return parseWorld(JSON.stringify(result), state, draft);
}
function saveTask(value: WorldTask, evidence = proof()): DomainCommand {
  return { type: 'SaveTask', commandId: 'save-task', task: ['completed','cancelled'].includes(value.status) && !value.resolution ? {...value,resolution:{at:actionTime,outcome:value.status==='completed'?'success':'cancelled',result:'本次工作结束',reason:'排程结束',sourceTurnId:'turn-a'}} : value, evidence };
}
function saveEvent(value: WorldEvent, evidence = proof()): DomainCommand {
  return { type: 'SaveEvent', commandId: 'save-event', event: value, evidence };
}
const actor = { kind: 'npc' as const, id: 'npc-a' };
function backgroundTask(): WorldTask {
  return { ...task(), actorRef: actor, dueAt: projectedTime };
}
function backgroundEvent(): WorldEvent {
  return { ...event(), actorRefs: [actor], estimatedEndAt: projectedTime };
}
function withTask(value = backgroundTask()) {
  return GameStateSchema.parse({ ...worldState(), tasks: { [value.id]: value } });
}
function withEvent(value = backgroundEvent()) {
  return GameStateSchema.parse({ ...worldState(), events: { [value.id]: value } });
}

describe('动态世界权限与同基线投影', () => {
  it('自主新事实不要求逐字出现在正文；模拟更新离场 NPC，与变量共享 revision 0，正式状态完全不变', () => {
    const state = worldState(),
      before = structuredClone(state),
      draft = worldDraft();
    const result = parse(worldResult([npcUpdate()]), state, draft);
    const projected = projectTurn(state, draft, result.worldCommands);
    expect(projected.npc['npc-a'].healthText).toBe('稍感疲倦');
    expect(projected.economy.cash).toBe(7000);
    expect(projected.revision).toBe(1);
    expect(projected.worldClock).toBe(projectedTime);
    expect(state).toEqual(before);
    expect(() =>
      commitCommands(projectTurn(state, draft), 'turn-a', 1, result.worldCommands),
    ).toThrow();
  });
  it.each([
    'SpendFunds',
    'SetWorldClock',
    'UpdateProtagonist',
    'AcquireItem',
    'SetEquipment',
    'TransferItem',
  ])('场外目录不授予 %s', (type) =>
    expect(commandCatalog('world').commandTypes).not.toContain(type),
  );
  it.each([
    npcUpdate({ onScene: true }),
    npcUpdate({ relationshipText: '主角已答应帮助他' }),
    npcUpdate({ lastInteractionAt: actionTime }),
    { ...npcUpdate(), affinityChange: { from: 30, to: 31, reason: '主角同意' } },
    { ...npcUpdate(), npcId: 'scene' },
    { ...npcUpdate(), expectedRevision: 1 },
  ])('拒绝现场、关系、好感、互动、版本越权 %#', (command) => {
    expect(() => parse(worldResult([command]))).toThrow();
  });
  it('开局同伴禁止更新；普通回合离场同伴仍有自主行动', () => {
    const state = GameStateSchema.parse({ ...worldState(), initialCompanionId: 'npc-a' });
    expect(() => parse(worldResult([npcUpdate()]), state, worldDraft(true, 'opening'))).toThrow();
    expect(parse(worldResult([npcUpdate()]), state)).toBeDefined();
  });
  it('本轮合法离场人物可更新独立后台字段，但不能重写Variables现场字段', () => {
    const state = worldState(),
      draft = worldDraft();
    draft.story!.narrative += '现场人物离开了现场。';
    draft.variables!.result.commands.push({
      type: 'UpdateNpc',
      commandId: 'leave',
      npcId: 'scene',
      expectedRevision: 0,
      changes: { onScene: false },
      evidence: '现场人物离开了现场。',
    });
    expect(() => parse(worldResult([{ ...npcUpdate(), npcId: 'scene' }]), state, draft)).not.toThrow();
    expect(() => parse(worldResult([{ ...npcUpdate({ onScene: false }), npcId: 'scene' }]), state, draft))
      .toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'scene_write_conflict' }) }));
  });
  it('地点增量创建支持合法父级；循环/不存在的父级和地点引用拒绝', () => {
    const create: DomainCommand = {
      type: 'CreateLocation',
      commandId: 'loc',
      evidence: proof(),
      location: { id: 'clinic', name: '社区诊所', parentId: 'chongqing' },
    };
    expect(parse(worldResult([create, npcUpdate({ locationId: 'clinic' })]))).toBeDefined();
    for (const parentId of ['missing', 'clinic'])
      expect(() =>
        parse(worldResult([{ ...create, location: { ...create.location, parentId } }])),
      ).toThrow();
    expect(() => parse(worldResult([npcUpdate({ locationId: 'missing' })]))).toThrow();
  });
  it('创建人物不能制造现场互动、已确认好感或内联私有记忆；稳定身份不能重复', () => {
    const person = {
      ...npc('new'),
      name: '新人物',
      onScene: false,
      affinity: 0,
      relationshipText: '尚未与主角接触',
    };
    const command: DomainCommand = {
      type: 'CreateNpc',
      commandId: 'new',
      evidence: proof(),
      npc: person,
    };
    expect(parse(worldResult([command]))).toBeDefined();
    for (const patch of [
      { onScene: true },
      { affinity: 1 },
      { identityKey: 'identity-npc-a' },
      { aliases: ['同事'] },
    ])
      expect(() => parse(worldResult([{ ...command, npc: { ...person, ...patch } }]))).toThrow();
  });
  it('组织创建不初始化资金经营估值，也不能内联主角关系', () => {
    for (const org of organizations) {
      const neutral = { ...org, protagonistRelation: '尚未与主角接触', relationHistory: [] };
      const command: DomainCommand = {
        type: 'CreateOrganization',
        commandId: 'org',
        evidence: proof(),
        organization: neutral,
      };
      expect(parse(worldResult([command]))).toBeDefined();
      expect(() => parse(worldResult([{ ...command, organization: org }]))).toThrow();
      if (neutral.kind === 'gang')
        expect(() =>
          parse(worldResult([{ ...command, organization: { ...neutral, funds: 1000 } }])),
        ).toThrow();
    }
  });
  it('同一命令 ID、重复内容及变量/世界 ID 冲突均拒绝', () => {
    const c = npcUpdate();
    for (const commands of [
      [c, c],
      [c, { ...c, commandId: 'copy' }],
      [c, { ...c, changes: { healthText: '健康' } }],
      [{ ...c, commandId: 'meal' }],
    ])
      expect(() => parse(worldResult(commands))).toThrow();
    const state = worldState(),
      valid = parse(worldResult([c]));
    const first = projectTurn(state, worldDraft(), valid.worldCommands);
    expect(
      commitCommands(first, 'turn-a', 0, [
        ...worldDraft().variables!.result.commands,
        ...valid.worldCommands,
      ]),
    ).toEqual(first);
    expect(() =>
      commitCommands(first, 'turn-a', 1, [{ ...c, changes: { healthText: '不同' } }]),
    ).toThrow();
  });
});

describe('世界任务与事件的状态、终态、来源和依赖', () => {
  it('合法自主任务完成有具体结果、时间和来源，不因旧阻碍拒绝', () => {
    const t = backgroundTask(),
      state = withTask(t),
      r = worldResult();
    r.taskCommands = [
      saveTask(
        { ...t, status: 'completed' },
        proof({
          sources: ['task:task-a', 'goal:npc-a:0'],
          outcome: '诊疗器材逐件归位并核对清单，目标所需的整理已实际完成。',
        }),
      ),
    ];
    expect(parse(r, state)).toBeDefined();
    state.tasks['task-a'].blockers = ['尚未取得钥匙'];
    expect(parse(r, state)).toBeDefined();
  });
  it.each(['future', 'actor', 'goal', 'terminal'])(
    '拒绝 %s 任务伪完成或重写',
    (scenario) => {
      let t = backgroundTask();
      const r = worldResult();
      let p = proof({ outcome: '器材逐件核对归位并记录核对清单。' });
      if (scenario === 'future')
        t = { ...t, startAt: '2026-10-19T08:00:00+08:00', dueAt: '2026-10-19T09:00:00+08:00' };
      if (scenario === 'actor') t = { ...t, actorRef: { kind: 'protagonist', id: 'hero' } };
      if (scenario === 'terminal') t = { ...t, status: 'cancelled' };
      const state = withTask(t);
      if (scenario === 'planned') p = proof({ kind: 'planned' });
      if (scenario === 'due') p = proof({ outcome: '任务已到期' });
      r.taskCommands = [
        saveTask(
          {
            ...t,
            status: 'completed',
            actorRef: actor,
            blockers: [],
            goal: scenario === 'goal' ? '改换目标' : t.goal,
          },
          p,
        ),
      ];
      expect(() => parse(r, state)).toThrow();
    },
  );
  it('原任务和结案均保留文本阻碍，不阻断完成', () => {
    const t = {...backgroundTask(), blockers:['门锁未打开']}, state=withTask(t), r=worldResult();
    r.taskCommands=[saveTask({...t,status:'completed'},proof({outcome:'本次工作结束，困难记录保留。'}))];
    expect(parse(r,state).taskCommands[0]).toMatchObject({task:{status:'completed',blockers:t.blockers}});
  });
  it('ID样式的文本条件不阻断推进；相同任务仍不能重复建档', () => {
    const t = backgroundTask(),
      state = withTask({ ...t, blockers: ['task:done'] });
    state.tasks.done = { ...t, id: 'done', goal: '领取钥匙', status: 'completed' };
    const r = worldResult();
    r.taskCommands = [saveTask({ ...state.tasks['task-a'], status: 'active' }, proof())];
    expect(parse(r, state)).toBeDefined();
    r.taskCommands = [saveTask({ ...t, id: 'new' }, proof({ kind: 'planned' }))];
    expect(() => parse(r, state)).toThrow();
  });
  it('未来安排仅一次SaveEvent写入，旧镜像字段不再接受',()=>{
 const e={...backgroundEvent(),startAt:'2026-10-18T09:00:00+08:00',estimatedEndAt:'2026-10-18T10:00:00+08:00'};
 const r=WorldResultSchema.parse({...worldResult(),eventCommands:[saveEvent(e,proof({kind:'planned'}))]});
 expect(parse(r)).toBeDefined();const state=projectTurn(worldState(),worldDraft(),parse(r).eventCommands);
 expect(state.events[e.id]).toMatchObject(e);expect(state.appliedCommands.filter(c=>c.commandId==='save-event')).toHaveLength(1);
 for(const futureEvents of [[e],[e,e]])expect(()=>parseWorld(JSON.stringify({...r,futureEvents}),worldState(),worldDraft())).toThrow();
});
  it('重大终态可进入时间线，不以成果分类作审批；无效时间及引用拒绝', () => {
    const e = backgroundEvent(),
      state = withEvent(e),
      before = structuredClone(state),
      r = worldResult();
    r.eventCommands = [
      saveEvent(
        { ...e, status: 'resolved', resolvedAt: actionTime, resolutionText: '器材清单核对完成' },
        proof({
          sources: ['event:event-a', 'goal:npc-a:0'],
          outcome: '诊疗器材全部核对，整理结果有清单可追溯。',
        }),
      ),
    ];
    r.worldCommands = [history('event-a')];
    expect(parse(r,state).worldCommands).toHaveLength(1);
    r.worldCommands=[];
    expect(parse(r, state)).toEqual(r);
    expect(state).toEqual(before);
    for (const bad of [
      {
        ...r,
        eventCommands: [
          saveEvent(
            { ...e, status: 'resolved', resolvedAt: '2026-10-18T10:00:00+08:00', resolutionText: '完成' },
            proof({ outcome: '整理结果已逐项记录并可追溯。' }),
          ),
        ],
      },
      {
        ...r,
        eventCommands: [
          saveEvent(
            { ...e, status: 'active', actorRefs: [{ kind: 'protagonist', id: 'hero' }] },
            proof(),
          ),
        ],
      },
      {
        ...r,
        eventCommands: [saveEvent({ ...e, status: 'active', sourceTurnIds: ['fake'] }, proof())],
      },
    ])
      expect(() => parseWorld(JSON.stringify(bad), state, worldDraft())).toThrow();
  });
  it('futureEvents 无法绕过旧事件终态、来源和未来结算限制', () => {
    const e = {
      ...backgroundEvent(),
      status: 'resolved' as const,
      resolvedAt: gameTime,
      resolutionText: '已经结案',
    };
    const state = withEvent(e);
    expect(() =>
      parseWorld(
        JSON.stringify({ ...worldResult(), futureEvents: [{ ...e, status: 'scheduled' }] }),
        state,
        worldDraft(),
      ),
    ).toThrow();
  });
});

describe('额外来源与状态阻断回归', () => {
  it('取消未来排程不等于提前执行；有动机的取消可保留原任务行动者', () => {
    const t = {
      ...backgroundTask(),
      startAt: '2026-10-19T08:00:00+08:00',
      dueAt: '2026-10-19T09:00:00+08:00',
      blockers: ['尚未领取钥匙'],
    };
    const r = worldResult();
    r.taskCommands = [
      saveTask(
        { ...t, status: 'cancelled' },
        proof({
          sources: ['task:task-a', 'goal:npc-a:0'],
          fact: '同事取消了明日的器材清点安排。',
          outcome: '钥匙交付中断且无法按期取得，负责人撤销原定排程。',
        }),
      ),
    ];
    expect(parse(r, withTask(t))).toBeDefined();
  });

  it('开局可以增量初始化场外人物及其任务/事件，不要求先正式提交人物', () => {
    const person = {
      ...npc('new'),
      name: '值班护士',
      onScene: false,
      affinity: 0,
      relationshipText: '尚未与主角接触',
    };
    const r = worldResult([
      {
        type: 'CreateNpc',
        commandId: 'new-person',
        npc: person,
        evidence: proof({ sources: ['story:current'], fact: '值班护士正在场外整理器材。' }),
      },
    ]);
    r.taskCommands = [
      saveTask(
        { ...backgroundTask(), actorRef: { kind: 'npc', id: 'new' }, goal: '明日值班准备' },
        proof({ kind: 'planned', sources: ['story:current'] }),
      ),
    ];
    r.eventCommands = [
      saveEvent(
        { ...backgroundEvent(), estimatedEndAt:'2026-10-19T08:00:00+08:00', actorRefs: [{ kind: 'npc', id: 'new' }], status: 'active' },
        proof({ sources: ['story:current'], fact: '值班护士正在场外整理器材。' }),
      ),
    ];
    expect(parse(r, worldState(), worldDraft(true, 'opening'))).toBeDefined();
  });
  it('旧完成条件不能被移除以自证成功，同批重复 SaveTask 被拒绝', () => {
    const t = { ...backgroundTask(), completionCondition: '取得钥匙并清点器材' },
      state = withTask(t),
      r = worldResult();
    r.taskCommands = [
      saveTask(
        { ...t, status: 'completed', completionCondition: undefined },
        proof({ outcome: '所有器材逐件归位并完成清单。' }),
      ),
    ];
    expect(() => parse(r, state)).toThrow();
    const c = saveTask(t, proof({ kind: 'planned' }));
    r.taskCommands = [c, { ...c, commandId: 'another-task-write' }];
    expect(() => parse(r, state)).toThrow();
  });
});

describe('真实世界模块与上下文', () => {
  it.each(['opening', 'regular'] as const)(
    '%s 使用独立主提示词、九域场外规则，输入不含玩家未来行动',
    async (mode) => {
      const state = worldState(),
        draft = worldDraft(true, mode),
        domains = selectWorldDomains(state, draft).domains;
      expect(domains).toHaveLength(9);
      const composed = await composePrompt({
        stage: 'world',
        mode,
        state,
        draft,
        domains,
        settings: defaultSettings(),
        userInput: '未来绝密动作',
      });
      const ids = composed.modules.map((m) => m.id);
      expect(ids).toContain(`stages.${mode}.world`);
      expect(ids).not.toContain(`stages.${mode === 'opening' ? 'regular' : 'opening'}.world`);
      expect(ids).not.toContain('shared.06_story_output');
      expect(ids.filter((id) => id.endsWith('.offscreen'))).toHaveLength(9);
      expect(JSON.stringify(composed.context)).not.toContain('未来绝密动作');
      expect(composed.context.TIME_WINDOW).toEqual({ from: gameTime, to: projectedTime });
      expect(JSON.stringify(composed.context.SAVE_STATE)).toContain('"id":"scene"');
      expect(composed.context).not.toHaveProperty('WORLD_SOURCES');
      expect(TurnDraftSchema.parse(draft)).toEqual(draft);
    },
  );
});
