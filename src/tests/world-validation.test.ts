import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { commandCatalog } from '../services/validation/commandCatalog';
import { WorldResultSchema, TurnDraftSchema } from '../domain/drafts';
import { GameStateSchema } from '../domain/state';
import { projectTurn } from '../domain/turnProjection';
import { commitCommands } from '../domain/commands';
import type { DomainCommand } from '../domain/commands';
import type { WorldTask, WorldEvent } from '../domain/events/schema';
import { worldSources } from '../services/validation/worldEvidence';
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
  return { type: 'SaveTask', commandId: 'save-task', task: value, evidence };
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
  it('本轮刚离场人物仍受现场保护，不二次执行', () => {
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
    expect(() => parse(worldResult([{ ...npcUpdate(), npcId: 'scene' }]), state, draft)).toThrow();
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
      { relationshipText: '主角已成为朋友' },
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

describe('世界来源、知识与时间窗口', () => {
  it.each([
    proof({ sources: ['invented'] }),
    proof({ at: '2026-10-18T07:59:00+08:00' }),
    proof({ at: '2026-10-18T08:11:00+08:00' }),
    proof({ kind: 'planned' }),
    proof({ fact: '同事准备完成整理。' }),
    proof({ fact: '并非同事已经完成整理。' }),
    '旧的字符串证据',
  ])('拒绝未知来源/越界/计划/否定/旧协议 %#', (evidence) =>
    expect(() => parse(worldResult([{ ...npcUpdate(), evidence }]))).toThrow(),
  );
  it('仅传闻或推测不能作为客观完成事实；私密来源不能转给另一人物', () => {
    const state = worldState();
    state.npc['npc-a'].knownInformation.push({
      text: '[转述]仓库已经开放',
      source: '听说',
      learnedAt: gameTime,
    });
    expect(() =>
      parse(
        worldResult([
          {
            ...npcUpdate(),
            evidence: proof({ sources: ['knowledge:npc-a:0'], fact: '仓库已经开放' }),
          },
        ]),
        state,
      ),
    ).toThrow();
    state.npc.other = { ...npc('other'), onScene: false };
    expect(() => parse(worldResult([{ ...npcUpdate(), npcId: 'other' }]), state)).toThrow();
  });
  it('自身有来源的记忆保持时间、可见性、知识性质；转述不能变为 observed', () => {
    const state = worldState();
    state.npc['npc-a'].knownInformation.push({
      text: '[转述]仓库已经开放',
      source: '听说',
      learnedAt: gameTime,
    });
    const memory: Extract<DomainCommand, { type: 'RecordNpcMemory' }> = {
      type: 'RecordNpcMemory',
      commandId: 'memory',
      expectedRevision: 0,
      npcId: 'npc-a',
      layer: 'personal',
      knowledgeKind: 'reported',
      addToKnownInformation: false,
      evidence: proof({ kind: 'reported', sources: ['knowledge:npc-a:0'], fact: '仓库已经开放' }),
      memory: {
        id: 'mem-a',
        text: '[转述]仓库已经开放',
        knowledgeSource: 'knowledge:npc-a:0 转述',
        createdAtGameTime: actionTime,
        sourceTurnIds: ['turn-a'],
        affectedEntityRefs: [actor],
        visibility: 'npc_private',
      },
    };
    expect(parse(worldResult([memory]), state)).toBeDefined();
    expect(() => parse(worldResult([{ ...memory, knowledgeKind: 'observed' }]), state)).toThrow();
    expect(() =>
      parse(
        worldResult([{ ...memory, memory: { ...memory.memory, visibility: 'player_known' } }]),
        state,
      ),
    ).toThrow();
    expect(() =>
      parse(
        worldResult([{ ...memory, memory: { ...memory.memory, createdAtGameTime: gameTime } }]),
        state,
      ),
    ).toThrow();
    const observed = {
      ...memory,
      knowledgeKind: 'observed' as const,
      evidence: proof(),
      memory: {
        ...memory.memory,
        text: '同事整理了诊室。',
        knowledgeSource: 'goal:npc-a:0 自身行动',
      },
    };
    expect(parse(worldResult([observed]), state)).toBeDefined();
  });
  it('不接受未来来源事实，也不在零时长窗口完成新地点/健康变化', () => {
    const state = worldState();
    state.npc['npc-a'].knownInformation.push({
      text: '仓库已经开放',
      source: '亲眼所见',
      learnedAt: projectedTime,
    });
    expect(() =>
      parse(
        worldResult([
          {
            ...npcUpdate(),
            evidence: proof({
              kind: 'established',
              sources: ['knowledge:npc-a:0'],
              fact: '仓库已经开放',
            }),
          },
        ]),
        state,
      ),
    ).toThrow();
    expect(() =>
      parse(
        worldResult([{ ...npcUpdate(), evidence: proof({ at: gameTime }) }]),
        state,
        worldDraft(false),
      ),
    ).toThrow();
    expect(
      parse(
        worldResult([
          {
            ...npcUpdate({}),
            activeGoals: ['整理明日排班'],
            evidence: proof({ kind: 'planned', at: gameTime }),
          },
        ]),
        state,
        worldDraft(false),
      ),
    ).toBeDefined();
  });
  it('保存的 validated 标志不能替代变量重新校验', () => {
    const draft = worldDraft();
    draft.variables!.result.commands[1] = { ...draft.variables!.result.commands[1], commandId: 'constructor' }; // 真正非法ID，而非文学关键词
    expect(() => parse(worldResult(), worldState(), draft)).toThrow();
  });
});

describe('世界任务与事件的状态、终态、来源和依赖', () => {
  it('合法自主任务完成有具体结果、时间和来源，阻碍未消除时拒绝', () => {
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
    expect(() => parse(r, state)).toThrow();
  });
  it.each(['planned', 'future', 'due', 'blocker', 'actor', 'goal', 'terminal'])(
    '拒绝 %s 任务伪完成或重写',
    (scenario) => {
      let t = backgroundTask();
      const r = worldResult();
      let p = proof({ outcome: '器材逐件核对归位并记录核对清单。' });
      if (scenario === 'future')
        t = { ...t, startAt: '2026-10-19T08:00:00+08:00', dueAt: '2026-10-19T09:00:00+08:00' };
      if (scenario === 'blocker') t = { ...t, blockers: ['门锁未打开'] };
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
  it('已解决依赖可以推进，未知/文本阻碍不能自证消除；相同任务不能重复建档', () => {
    const t = backgroundTask(),
      state = withTask({ ...t, blockers: ['task:done'] });
    state.tasks.done = { ...t, id: 'done', goal: '领取钥匙', status: 'completed' };
    const r = worldResult();
    r.taskCommands = [saveTask({ ...state.tasks['task-a'], status: 'active' }, proof())];
    expect(parse(r, state)).toBeDefined();
    r.taskCommands = [saveTask({ ...t, id: 'new' }, proof({ kind: 'planned' }))];
    expect(() => parse(r, state)).toThrow();
  });
  it('futureEvents 必须是有来源、未存在、scheduled SaveEvent 的完全镜像', () => {
    const e = {
      ...backgroundEvent(),
      startAt: '2026-10-18T09:00:00+08:00',
      estimatedEndAt: '2026-10-18T10:00:00+08:00',
    };
    const r = WorldResultSchema.parse({
      ...worldResult(),
      eventCommands: [saveEvent(e, proof({ kind: 'planned' }))],
      futureEvents: [e],
    });
    expect(parse(r)).toBeDefined();
    expect(
      projectTurn(worldState(), worldDraft(), parse(r).eventCommands).appliedCommands.filter(
        (c) => c.commandId === 'save-event',
      ),
    ).toHaveLength(1);
    for (const bad of [
      { ...r, eventCommands: [] },
      { ...r, futureEvents: [e, e] },
      { ...r, futureEvents: [{ ...e, status: 'resolved' }] },
      { ...r, eventCommands: [saveEvent(e, '未来自动触发')] },
    ])
      expect(() => parseWorld(JSON.stringify(bad), worldState(), worldDraft())).toThrow();
    expect(() => parse(r, withEvent(e))).toThrow();
  });
  it('隐藏重大事件不进入公开时间线候选；结案仍可保存为内部世界结果', () => {
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
    r.timelineCandidates = ['event-a'];
    expect(()=>parse(r,state)).toThrow();
    r.timelineCandidates=[];
    expect(parse(r, state)).toEqual(r);
    expect(state).toEqual(before);
    for (const bad of [
      {
        ...r,
        eventCommands: [
          saveEvent(
            { ...e, status: 'resolved', resolvedAt: projectedTime, resolutionText: '完成' },
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
      {
        ...r,
        eventCommands: [saveEvent({ ...e, status: 'active', visibility: 'known' }, proof())],
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

  it('不能以主角私密正文作为 NPC 自主动作的唯一依据', () => {
    const command = { ...npcUpdate(), evidence: proof({ sources: ['story:current'] }) };
    expect(() => parse(worldResult([command]))).toThrow();
  });
  it('有名字的场外客观事实可引用；对白或计划不能伪装 established', () => {
    const fact = '同事整理诊室后稍感疲倦。';
    const draft = worldDraft();
    draft.story!.narrative += fact;
    const command = {
      ...npcUpdate(),
      evidence: proof({ kind: 'established', sources: ['story:current'], fact }),
    };
    expect(parse(worldResult([command]), worldState(), draft)).toBeDefined();
    for (const prefix of ['【同事】', '同事声称', '并非']) {
      const invalid = worldDraft();
      invalid.story!.narrative += prefix + fact;
      expect(() => parse(worldResult([command]), worldState(), invalid)).toThrow();
    }
  });
  it('被阻碍任务不能作为人物完成动作的捷径来源', () => {
    const state = withTask({ ...backgroundTask(), blockers: ['钥匙尚未取得'] });
    expect(() =>
      parse(
        worldResult([
          { ...npcUpdate(), evidence: proof({ sources: ['task:task-a', 'goal:npc-a:0'] }) },
        ]),
        state,
      ),
    ).toThrow();
  });
  it('未来或 planned 来源不能标记任务/事件已经受阻', () => {
    const r = worldResult();
    r.taskCommands = [
      saveTask({ ...backgroundTask(), status: 'blocked' }, proof({ kind: 'planned' })),
    ];
    expect(() => parse(r)).toThrow();
    const e = {
      ...backgroundEvent(),
      status: 'blocked' as const,
      startAt: '2026-10-19T08:00:00+08:00',
      estimatedEndAt: '2026-10-19T09:00:00+08:00',
    };
    r.taskCommands = [];
    r.eventCommands = [saveEvent(e)];
    expect(() => parse(r)).toThrow();
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
      expect(
        worldSources(projectTurn(state, draft), draft, state).some((s) => s.id === 'npc:scene'),
      ).toBe(false);
      expect(TurnDraftSchema.parse(draft)).toEqual(draft);
    },
  );
});
