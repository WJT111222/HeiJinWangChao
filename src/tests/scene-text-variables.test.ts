import { describe, expect, it } from 'vitest';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import type { ExecutionResult } from '../executors/variableText';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { game, npc, story } from './fixtures/game';

function unwrap<T>(r: ExecutionResult<T>): T { if (!r.ok) throw new Error(r.error.code); return r.value; }
function setup(body: string) {
  const state = game(); state.turnNumber = 1;
  state.journal = [{ turnId: 'previous', revision: 0, story, relatedActorRefs: [] }];
  state.npc.follow = npc('follow'); state.npc.stay = npc('stay');
  state.npc.remote = { ...npc('remote'), onScene: false };
  state.locations.clinic = { id: 'clinic', name: '诊所', parentId: 'chongqing' };
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'scene-turn', 'regular', '进入诊所'), story);
  const parsed = parseVariableText(`<命令>\n${body}\n</命令>`); if (!parsed.ok) throw new Error('样本解析失败');
  return { state, context: { draft, expectedRevision: state.revision }, ast: parsed.value };
}
async function execute(body: string) {
  const d = setup(body), before = structuredClone(d);
  const plan = unwrap(await compileVariableCommands(d.ast, d.state, d.context));
  const after = unwrap(await simulateVariablePlan(plan, d.state, d.context));
  expect(d).toEqual(before);
  return { ...d, plan, after };
}
const move = 'set protagonist.locationId = "clinic"\nset npc[follow].locationId = "clinic"\nset npc[stay].onScene = false';
describe('M8-P0C-3C1 现场文本变量', () => {
  it('普通回合可推进结构化时间，不读设备日期', async () => {
    const r = await execute('set worldClock = "2026-10-18T08:05:00+08:00"');
    expect(r.after.worldClock).toBe('2026-10-18T08:05:00+08:00');
  });
  it('主角和同行NPC同时移动，留守NPC保持原地点', async () => {
    const r = await execute(move);
    expect(r.after.protagonist.locationId).toBe('clinic');
    expect(r.after.npc.follow).toMatchObject({ onScene: true, locationId: 'clinic' });
    expect(r.after.npc.stay).toMatchObject({ onScene: false, locationId: 'chongqing' });
  });
  it('创建新地点并进入，创建只作用于稳定ID', async () => {
    const r = await execute('set locations[station] = {"name":"车站","parentId":"chongqing"}\n' + move.replaceAll('clinic','station'));
    expect(r.after.locations.station).toEqual({ id: 'station', name: '车站', parentId: 'chongqing' });
  });
  it('NPC先入场再补地点、先清地点再离场，按最终状态检查', async () => {
    const d = setup('set npc[remote].onScene = true\nset npc[remote].locationId = "chongqing"\nset npc[stay].locationId = null\nset npc[stay].onScene = false');
    delete d.state.npc.remote.locationId;
    const plan = unwrap(await compileVariableCommands(d.ast, d.state, d.context));
    const after = unwrap(await simulateVariablePlan(plan, d.state, d.context));
    expect(after.npc.remote).toMatchObject({ onScene: true, locationId: 'chongqing' });
    expect(after.npc.stay.onScene).toBe(false); expect(after.npc.stay.locationId).toBeUndefined();
  });
  it.each(['profession','publicStatus','legalStatus'] as const)('主角%s有精确映射', async (field) => {
    const r = await execute(`set protagonist.${field} = "新的剧情状态"`);
    expect(r.after.protagonist[field]).toBe('新的剧情状态');
  });
  it('技能仅通过严格字符串数组设置', async () => {
    const r = await execute('set protagonist.skills = ["驾驶","教学"]');
    expect(r.after.protagonist.skills).toEqual(['驾驶','教学']);
  });
  it('正文无时间词，互动和记忆可使用本批最后的时钟', async () => {
    const r = await execute('set npc[remote].lastInteractionAt = "2026-10-18T08:05:00+08:00"\npush npc[remote].memories = {"text":"接到电话","knowledgeKind":"reported","knowledgeSource":"本轮交谈","visibility":"npc_private"}\nset worldClock = "2026-10-18T08:05:00+08:00"');
    expect(r.after.npc.remote.lastInteractionAt).toBe(r.after.worldClock);
    expect(r.after.npc.remote.memories[0].createdAtGameTime).toBe(r.after.worldClock);
    expect(r.after.npc.follow.memories).toEqual([]);
  });
});

async function resultFor(d: ReturnType<typeof setup>) {
  const plan = await compileVariableCommands(d.ast, d.state, d.context);
  return plan.ok ? simulateVariablePlan(plan.value, d.state, d.context) : plan;
}
function opening(body: string) {
  const d = setup(body);
  d.state.turnNumber = 0; d.state.journal = [];
  d.state.openingTimePending = true; d.state.worldClock = '0001-01-01T00:00:00+08:00';
  d.context.draft = rerollStory(createTurnDraft(d.state.saveId, 0, 'opening-scene', 'opening', ''), {
    ...story, turnKind: 'opening', variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({
      startAt: '2015-07-08T08:00:00+08:00', endAt: '2015-07-08T08:05:00+08:00',
    }) }],
  });
  return d;
}
describe('时间、地点和原子数据约束', () => {
  it.each(['set protagonist.healthText = "健康"', 'set worldClock = "2015-07-08T08:05:00+08:00"\nset protagonist.healthText = "健康"',
    'set worldClock = "2015-07-08T00:05:00Z"\nset worldClock = "2015-07-08T08:05:00+08:00"'])(
    '开局程序时钟只应用一次并可精确重放：%s', async (body) => {
      const d = opening(body), before = structuredClone(d);
      const plan = unwrap(await compileVariableCommands(d.ast, d.state, d.context));
      expect(plan.commands.filter((c) => c.type === 'SetWorldClock')).toHaveLength(1);
      expect(plan.commands[0].commandId).toBe(`opening-clock:${d.context.draft.storyRevision}`);
      expect(plan.origins[0]).toBeNull();
      const first = unwrap(await simulateVariablePlan(plan, d.state, d.context));
      expect(first.worldClock).toBe('2015-07-08T08:05:00+08:00');
      const replay = unwrap(await compileVariableCommands(d.ast, first, d.context));
      expect(unwrap(await simulateVariablePlan(replay, first, d.context))).toEqual(first);
      expect(d).toEqual(before);
    });
  it('开局不能在Story endAt之上再加时', async () => {
    const d = opening('set worldClock = "2015-07-08T08:10:00+08:00"');
    expect((await resultFor(d)).ok).toBe(false); expect(d.state.openingTimePending).toBe(true);
  });
  it.each(['2026-10-18T08:00:00+08:00','2026-10-18T00:01:00Z','2026-10-19T08:00:00+08:00'])(
    '普通时钟接受合法ISO时间 %s', async (time) => expect((await execute(`set worldClock = "${time}"`)).after.worldClock).toBe(time));
  it.each(['2027-01-01T00:00:01+08:00','2028-02-29T23:59:59+08:00'])(
    '跨年/闰日时间 %s 可用', async (time) => expect((await execute(`set worldClock = "${time}"`)).after.worldClock).toBe(time));
  it.each(['"2026-02-30T08:00:00+08:00"','"2026:03:26:21:05"','"2026-10-18T08:05:00"','null','123'])(
    '不合法日期/类型%s整批失败', async (value) => {
      const d = setup(`set protagonist.emotionText = "轻松"\nset worldClock = ${value}`), before = structuredClone(d);
      expect((await resultFor(d)).ok).toBe(false); expect(d).toEqual(before);
    });
  it.each(['set worldClock = "2026-10-18T07:59:59+08:00"',
    'set worldClock = "2026-10-18T09:00:00+08:00"\nset worldClock = "2026-10-18T08:30:00+08:00"'])(
    '拒绝回退，包含同批中间时钟回退：%s', async (body) => {
      const d = setup(`set protagonist.emotionText = "轻松"\n${body}`), before = structuredClone(d);
      expect((await resultFor(d)).ok).toBe(false); expect(d).toEqual(before);
    });
  it('时间前置规范化保留原命令ID和位置', async () => {
    const r = await execute('set protagonist.emotionText = "轻松"\nset worldClock = "2026-10-18T08:05:00+08:00"');
    expect(r.plan.commands.map((c) => c.commandId)).toEqual(['text-v1:s1:c2','text-v1:s1:c1']);
    expect(r.plan.origins.map((o) => o?.commandIndex)).toEqual([2,1]);
  });
  it('允许多级地点前向引用，按最终地点树检查', async () => {
    const r = await execute('set locations[room] = {"name":"房间","parentId":"building"}\nset locations[building] = {"name":"办公楼","parentId":"chongqing"}');
    expect(r.after.locations.room.parentId).toBe('building');
  });
  it.each(['set locations[clinic] = {"name":"覆盖旧地点"}', 'set locations[hero] = {"name":"与主角ID冲突"}',
    'set locations[x] = {"name":"错误父级","parentId":"missing"}',
    'set locations[x] = {"name":"循环","parentId":"y"}\nset locations[y] = {"name":"循环","parentId":"x"}',
    'set locations[x] = {"id":"other","name":"路径ID不可替换"}',
    'set locations[x] = {"name":"房间","secret":"任意字段"}', 'set locations[x] = {"name":"自身","parentId":"x"}',
    'set protagonist.locationId = "missing"\nset npc[follow].onScene = false\nset npc[stay].onScene = false',
    'set npc[remote].locationId = "missing"'])(
    '非法地点操作不产生部分状态：%s', async (body) => {
      const d = setup(`set protagonist.emotionText = "轻松"\n${body}`), before = structuredClone(d);
      const r = await resultFor(d); expect(r.ok).toBe(false); expect(r).not.toHaveProperty('value'); expect(d).toEqual(before);
    });
});

describe('现场状态和类型边界', () => {
  it('多名NPC同时入场/离场，未知去向明确清除', async () => {
    const r = await execute('set npc[follow].onScene = false\nset npc[follow].locationId = null\nset npc[remote].onScene = true\nset npc[stay].onScene = false');
    expect(r.after.npc.follow.locationId).toBeUndefined(); expect(r.after.npc.remote.onScene).toBe(true);
    expect(r.after.npc.stay.locationId).toBe('chongqing');
  });
  it('离场NPC可更新健康、关系和地点，不要求在场证明', async () => {
    const r = await execute('set npc[remote].healthText = "健康"\nset npc[remote].relationshipText = "保持联络"\nset npc[remote].locationId = "clinic"');
    expect(r.after.npc.remote).toMatchObject({ healthText: '健康', relationshipText: '保持联络', locationId: 'clinic', onScene: false });
  });
  it('主角健康/情绪和全部新文本字段可同批修改', async () => {
    const r = await execute('set protagonist.healthText = "疲惫"\nset protagonist.emotionText = "平静"\nset protagonist.profession = "司机"\nset protagonist.publicStatus = "市民"\nset protagonist.legalStatus = "无涉案记录"');
    expect(r.after.protagonist).toMatchObject({ healthText: '疲惫', emotionText: '平静', profession: '司机', publicStatus: '市民', legalStatus: '无涉案记录' });
  });
  it.each(['set protagonist.profession = null','set protagonist.skills = ["驾驶",2]','set protagonist.skills = {"strength":1}',
    'set protagonist.publicStatus = 3','set protagonist.legalStatus = false','set npc[remote].onScene = "true"',
    'set npc[remote].lastInteractionAt = "明天"','set npc[remote].locationId = 3',
    'set npc[remote].onScene = true\nset npc[remote].locationId = null',
    'set npc[remote].onScene = true\nset npc[remote].locationId = "clinic"',
    'set npc[remote].lastInteractionAt = "2026-10-18T08:05:00+08:00"'])(
    '不合法字段/场景/未来互动整批拒绝：%s', async (body) => {
      const d = setup(`set protagonist.emotionText = "轻松"\n${body}`), before = structuredClone(d);
      expect((await resultFor(d)).ok).toBe(false); expect(d).toEqual(before);
    });
  it('新入场但未提供任何地点仍失败，旧未知地点健康更新继续兼容', async () => {
    const d = setup('set npc[remote].onScene = true'); delete d.state.npc.remote.locationId;
    expect((await resultFor(d)).ok).toBe(false);
    const old = setup('set npc[follow].healthText = "健康"'); delete old.state.npc.follow.locationId;
    expect((await resultFor(old)).ok).toBe(true);
  });
  it.each(['observed','reported','suspected'])('新增%s个人记忆只属于指定人物', async (kind) => {
    const r = await execute(`push npc[remote].memories = ${JSON.stringify({ text:'收到工作消息',knowledgeKind:kind,knowledgeSource:'本轮交谈',visibility:'npc_private' })}`);
    expect(r.after.npc.remote.memories[0].knowledgeKind).toBe(kind);
    expect(r.after.npc.follow.memories).toEqual([]); expect(r.after.npc.stay.memories).toEqual([]);
  });
});

const mixed = 'set locations[station] = {"name":"车站","parentId":"chongqing"}\nset protagonist.locationId = "station"\nset npc[follow].locationId = "station"\nset npc[stay].onScene = false\nset protagonist.profession = "司机"\nset protagonist.skills = ["驾驶"]\nset npc[remote].lastInteractionAt = "2026-10-18T08:05:00+08:00"\npush npc[remote].memories = {"text":"电话约好见面","knowledgeKind":"reported","knowledgeSource":"通话","visibility":"npc_private"}\nset worldClock = "2026-10-18T08:05:00+08:00"';
describe('重放、版本、正式链路隔离', () => {
  it('新地点、移动、时间、职业、技能、互动与记忆整批重放完全幂等', async () => {
    const r = await execute(mixed);
    expect(r.after.revision).toBe(r.state.revision + 1);
    expect(r.after.npc.remote.memories).toHaveLength(1);
    const again = unwrap(await compileVariableCommands(r.ast, r.after, r.context));
    expect(again.commands).toEqual(r.plan.commands);
    expect(unwrap(await simulateVariablePlan(again, r.after, r.context))).toEqual(r.after);
    expect(r.state.locations.station).toBeUndefined(); expect(r.state.worldClock).toBe('2026-10-18T08:00:00+08:00');
  });
  it('开局等价UTC文本仍使用程序时钟的规范表示记录记忆', async () => {
    const d = opening('push npc[remote].memories = {"text":"接到电话","knowledgeKind":"reported","knowledgeSource":"电话","visibility":"npc_private"}\nset worldClock = "2015-07-08T00:05:00Z"');
    const r = unwrap(await resultFor(d));
    expect(r.npc.remote.memories[0].createdAtGameTime).toBe(r.worldClock);
  });
  it.each(['save','story','attempt'] as const)('旧计划在%s变化后不可覆盖新状态', async (change) => {
    const d = setup(mixed), plan = unwrap(await compileVariableCommands(d.ast, d.state, d.context));
    if (change === 'save') d.state.revision++;
    if (change === 'story') d.context.draft = rerollStory(d.context.draft, { ...story, narrative: '新的正文' });
    if (change === 'attempt') {
      const { startStageAttempt } = await import('../domain/drafts'); d.context.draft = startStageAttempt(d.context.draft, ['variables']);
    }
    const before = structuredClone(d); expect((await simulateVariablePlan(plan, d.state, d.context)).ok).toBe(false); expect(d).toEqual(before);
  });
  it('同一命令ID改变地点或时间后重放冲突', async () => {
    const r = await execute(mixed), changed = setup(mixed.replaceAll('station','airport'));
    expect((await compileVariableCommands(changed.ast, r.after, r.context)).ok).toBe(false);
  });
  it('地点名称、父级与技能值不会成为任意对象覆盖器', async () => {
    const d = setup('set locations = {"x":{"name":"任意表"}}'); expect((await resultFor(d)).ok).toBe(false);
    const deep = setup('set protagonist.skills[0].name = "任意嵌套"'); expect((await resultFor(deep)).ok).toBe(false);
  });
  it('只读桥接区分普通时钟更新，不声称未改变', async () => {
    const { captureVariableTextPreviewBasis, previewVariableTextReply } = await import('../bridges/variableText');
    const d = setup(''), basis = await captureVariableTextPreviewBasis(d.state, d.context.draft);
    if (!basis.ok) throw new Error('样本');
    const r = await previewVariableTextReply('<命令>set worldClock = "2026-10-18T08:05:00+08:00"</命令>', d.state, d.context.draft, basis.value);
    expect(r.ok).toBe(true); if (r.ok) expect(r.previewState.clockKind).toBe('updated');
    expect(d.state.worldClock).toBe('2026-10-18T08:00:00+08:00');
  });
  it('JSON正式入口可使用同一批领域命令，原候选/存档保持不变', async () => {
    const { parseVariables } = await import('../services/validation/aiOutputs');
    const r = await execute(mixed), before = structuredClone(r.state);
    const result = parseVariables(JSON.stringify({ commands: r.plan.commands, rejectedSuggestions: [], unresolved: [] }), r.state, r.context.draft);
    expect(result.commands).toEqual(r.plan.commands); expect(r.state).toEqual(before);
  });
  it('完整场景数据校验允许合法的清地点再退场，不影响原NPC生命周期', async () => {
    const { commitCommands } = await import('../domain/commands'); const d = setup('');
    const after = commitCommands(d.state, 'independent-lifecycle', 0, [
      { type:'UpdateNpc', commandId:'clear', evidence:'NPC离开', npcId:'remote', expectedRevision:0, changes:{locationId:null} },
      { type:'RetireNpc', commandId:'retire', evidence:'NPC退场', npcId:'remote', expectedIdentityKey:d.state.npc.remote.identityKey, reason:'无后续职责', retainMemoryIds:[] },
    ], d.state.updatedAt);
    expect(after.npc.remote).toBeUndefined(); expect(after.retiredNpcs.remote).toBeDefined(); expect(d.state.npc.remote).toBeDefined();
  });
  it('执行器不导入World/AI/数据库/新审查模块，正式工作流不接入文本执行器', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    for (const f of readdirSync('src/executors/variableText')) {
      expect(readFileSync(`src/executors/variableText/${f}`,'utf8')).not.toMatch(/from\s+['"][^'"]*(?:workflows|services\/ai|storage|candidates)/);
    }
    for (const f of ['src/workflows/variableStage.ts','src/workflows/worldStage.ts','src/workflows/turnCoordinator.ts','src/services/storage/saveRepository.ts'])
      expect(readFileSync(f,'utf8')).not.toContain('executors/variableText');
  });
});

describe('原领域分步场景更新的回归', () => {
  it.each(['enter','leave'] as const)('原领域分步%s按最终位置检查，不依赖命令顺序', async (kind) => {
    const { commitCommands } = await import('../domain/commands'); const d = setup('');
    if (kind === 'enter') delete d.state.npc.remote.locationId;
    const before = structuredClone(d.state);
    const commands: import('../domain/commands').DomainCommand[] = kind === 'enter' ? [
      { type:'UpdateNpc', commandId:'enter', evidence:'本轮状态', npcId:'remote', expectedRevision:0, changes:{onScene:true} },
      { type:'UpdateNpc', commandId:'position', evidence:'本轮地点', npcId:'remote', expectedRevision:0, changes:{locationId:'chongqing'} },
    ] : [
      { type:'UpdateNpc', commandId:'position', evidence:'本轮地点', npcId:'follow', expectedRevision:0, changes:{locationId:null} },
      { type:'UpdateNpc', commandId:'leave', evidence:'本轮状态', npcId:'follow', expectedRevision:0, changes:{onScene:false} },
    ];
    const after = commitCommands(d.state, 'scene-domain-order', 0, commands, d.state.updatedAt);
    if (kind === 'enter') expect(after.npc.remote).toMatchObject({onScene:true,locationId:'chongqing'});
    else { expect(after.npc.follow.onScene).toBe(false); expect(after.npc.follow.locationId).toBeUndefined(); }
    expect(d.state).toEqual(before);
  });
});
