import { describe, expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { defaultSettings } from '../ui/settings/model';
import { parseVariables } from '../services/validation/aiOutputs';
import { timeState, timeDraft } from './fixtures/time';
import { timePreflight, timeOutcome, validateTimeCommands } from '../domain/timePreflight';
import { worldWeekday } from '../prompts/context';
import { worldSources } from '../services/validation/worldEvidence';
import { task } from './fixtures/game';

const sleepingState = () => timeState();
const visitor = () => timeState(true);
const draft = timeDraft;
describe('时间预检真实Composer和变量校验缺口', () => {
  it('普通正文请求实际携带长行动的TIME_PREFLIGHT，纯预检不写时钟', async () => {
    const state = visitor(), before = structuredClone(state), selected = draft(state);
    const prompt = await composePrompt({ state, draft: selected, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: selected.userInput });
    expect(prompt.context.TIME_PREFLIGHT).toEqual(expect.objectContaining({ from: state.worldClock, targetAt: '2027-01-01T08:00:00+08:00', candidates: expect.arrayContaining([expect.objectContaining({ id: 'visitor', at: '2027-01-01T03:00:00+08:00' })]) }));
    expect(state).toEqual(before);
  });
  it('已经选择三点中断的正文不能用合法结构命令跳过中断时间', () => {
    const state = visitor(), selected = draft(state, undefined, true);
    selected.story!.narrative += '次日08:00，你自然醒来。';
    const result = { commands: [{ type: 'SetWorldClock', commandId: 'overshoot', worldClock: '2027-01-01T08:00:00+08:00', evidence: '次日08:00，你自然醒来。' }], rejectedSuggestions: [], unresolved: [] };
    expect(() => parseVariables(JSON.stringify(result), state, selected)).toThrow();
  });
});

describe('确定性时间意图与中国标准时间', () => {
  it.each([
    ['睡到第二天早上8点', '2027-01-01T08:00:00+08:00'],
    ['睡到次日早上8点', '2027-01-01T08:00:00+08:00'],
    ['等两天', '2027-01-02T23:00:00+08:00'],
    ['在家休息三个小时', '2027-01-01T02:00:00+08:00'],
    ['工作半个小时', '2026-12-31T23:30:00+08:00'],
    ['休息一个半小时', '2027-01-01T00:30:00+08:00'],
    ['等待2027年1月1日08:00', undefined], // 没有“到”不猜测目标。
    ['等待到2027年1月1日08:00', '2027-01-01T08:00:00+08:00'],
    ['等到2027-01-01T00:00:00Z', '2027-01-01T08:00:00+08:00'],
  ])('%s → %s', (action, end) => expect(timePreflight(sleepingState(), action).targetAt).toBe(end));
  it.each(['休息几个小时', '等待一会儿', '如果能休息两小时就好了', '回忆昨天睡三小时的经历', '不要睡到明天早上8点', '等两到三小时', '睡三小时然后工作两小时', '等到2027-02-30 08:00'])('模糊、条件、历史、否定及非法日期不伪造精确终点：%s', (action) => {
    expect(timePreflight(sleepingState(), action).targetAt).toBeUndefined();
  });
  it('明早无精确小时是范围估计；预计旅行时长不是必达承诺', () => {
    expect(timePreflight(sleepingState(), '睡到次日早上')).toMatchObject({ resolution: 'estimated', endWindow: { from: '2027-01-01T06:00:00+08:00', to: '2027-01-01T12:00:00+08:00' } });
    expect(timePreflight(sleepingState(), '预计坐车三小时')).toMatchObject({ resolution: 'estimated', actionKind: 'travel', endWindow: { to: '2027-01-01T02:00:00+08:00' } });
    expect(timePreflight(sleepingState(), '随便看看')).toMatchObject({ resolution: 'none', candidates: [] });
  });
  it.each([
    ['2028-02-28T23:00:00+08:00', '2028-02-29T01:00:00+08:00', '星期二'],
    ['2027-02-28T23:00:00+08:00', '2027-03-01T01:00:00+08:00', '星期一'],
    ['2026-12-31T15:00:00Z', '2027-01-01T01:00:00+08:00', '星期五'],
  ])('跨日/月/年及闰年，世界时间%s', (clock, expected, weekday) => {
    const state = sleepingState(); state.worldClock = clock;
    const plan = timePreflight(state, '等待两小时'); expect(plan.targetAt).toBe(expected); expect(worldWeekday(expected)).toBe(weekday);
  });
});
describe('只读事件节点筛选、知识与生命周期', () => {
  it('没有事件时正常睡眠；已知访客为条件候选且允许不打断', () => {
    expect(timePreflight(sleepingState(), '睡到明早8点').candidates).toEqual([]);
    expect(timePreflight(visitor(), '睡到明早8点').candidates).toHaveLength(1);
    expect(timeOutcome(visitor(), draft(visitor()))!.at).toBe('2027-01-01T08:00:00+08:00');
  });
  it.each(['cancelled', 'resolved', 'blocked'] as const)('%s不触发', (status) => {
    const state = visitor(); state.events.visitor.status = status;
    expect(timePreflight(state, '睡到明早8点').candidates).toEqual([]);
  });
  it('未满足条件、未知阻碍、任务只有预计到期均不自动完成', () => {
    const state = visitor(), before = structuredClone(state);
    state.events.visitor.prerequisites = ['event:unknown'];
    state.tasks['overdue'] = { ...task('overdue'), actorRef: { kind: 'protagonist', id: state.protagonist.id }, status: 'planned', dueAt: state.events.visitor.startAt };
    expect(timePreflight(state, '睡到明早8点').candidates).toEqual([]); expect(state.tasks.overdue.status).toBe('planned');
    state.events.visitor.prerequisites = []; state.events.visitor.blockers = ['task:overdue'];
    expect(timePreflight(state, '睡到明早8点').candidates).toEqual([]); expect(before.events.visitor.status).toBe(state.events.visitor.status);
  });
  it('预计结束时间不是触发节点；事件必须在目标范围内且能触及当前场景', () => {
    const state = visitor(); state.events.visitor.startAt = '2027-01-01T09:00:00+08:00'; state.events.visitor.estimatedEndAt = '2027-01-01T03:00:00+08:00';
    expect(timePreflight(state, '睡到明早8点').candidates).toEqual([]);
    state.events.visitor.startAt = '2027-01-01T03:00:00+08:00'; state.events.visitor.locationId = 'chongqing';
    expect(timePreflight(state, '睡到明早8点').candidates).toEqual([]); // 同城不能等价于同一间屋子。
  });
  it('通讯须直接关联主角；旅行不沿用离开的住所敲门事件，相关现场阻碍可作为候选', () => {
    const state = visitor(); expect(timePreflight(state, '坐车等待五小时').candidates).toEqual([]);
    state.events.visitor.title = '主角的重要电话来电'; state.events.visitor.locationId = undefined;
    expect(timePreflight(state, '等待五小时').candidates[0]?.channel).toBe('communication');
    state.events.visitor.actorRefs = [{ kind: 'npc', id: 'npc-a' }]; expect(timePreflight(state, '等待五小时').candidates).toEqual([]);
    state.events.visitor.title = '现场道路封闭阻碍行驶'; state.events.visitor.locationId = 'home'; state.events.visitor.actorRefs = [{ kind: 'protagonist', id: state.protagonist.id }];
    expect(timePreflight(state, '开车五小时').candidates[0]?.channel).toBe('obstruction');
  });
  it('隐藏事件和私有任务从预检中完全消失，worldEventOnly边界不变', async () => {
    const state = visitor(); state.events.visitor.visibility = 'hidden'; state.events.visitor.title = '只有NPC知道的秘密敲门计划';
    const selected = draft(state), prompt = await composePrompt({ state, draft: selected, stage: 'story', mode: 'regular', settings: defaultSettings(), userInput: selected.userInput });
    expect(JSON.stringify(prompt.context)).not.toContain('只有NPC知道'); expect(timePreflight(state, selected.userInput).candidates).toEqual([]);
    expect(worldSources(state, selected).find((source) => source.id === 'event:visitor')?.worldEventOnly).toBe(true);
  });
  it('行动或地点变更时重算；同时间已正式中断的事件不能再次触发', () => {
    const state = visitor(); expect(timePreflight(state, '等待一小时').candidates).toEqual([]);
    const selected = draft(state, undefined, true); state.worldClock = state.events.visitor.startAt;
    state.journal[0].story = selected.story!;
    expect(timePreflight(state, '睡到早上8点').candidates).toEqual([]);
    state.journal[0].story.variableGuide[0].textEvidence = '访客实际触发中断的概括说明';
    expect(timePreflight(state, '睡到早上8点').candidates).toEqual([]);
    state.journal[0].story.variableGuide = []; state.protagonist.locationId = 'chongqing';
    expect(timePreflight(state, '睡到早上8点').candidates).toEqual([]);
  });
  it('结构化中断记录保持唯一/有效候选与时间，不要求逐字来源', () => {
    const state = visitor(), selected = draft(state, undefined, true);
    expect(timeOutcome(state, selected, true)?.at).toBe(state.events.visitor.startAt);
    for (const bad of [
      { ...selected, story: { ...selected.story!, variableGuide: [...selected.story!.variableGuide, ...selected.story!.variableGuide] } },
      { ...selected, story: { ...selected.story!, variableGuide: [{ ...selected.story!.variableGuide[0], observedFact: '2027-01-01T04:00:00+08:00' }] } },
    ]) expect(() => timeOutcome(state, bad, true)).toThrow();
    const commands = [{ type: 'SetWorldClock' as const, commandId: 'time', worldClock: state.events.visitor.startAt, evidence: selected.story!.variableGuide[0].textEvidence! }];
    expect(() => validateTimeCommands(state, selected, commands)).not.toThrow(); expect(() => validateTimeCommands(state, selected, [])).not.toThrow();
    expect(timeOutcome(state, { ...selected, story: { ...selected.story!, variableGuide: [] } }, true)).toBeUndefined();
    expect(timeOutcome(state, { ...selected, story: { ...selected.story!, variableGuide: [{ ...selected.story!.variableGuide[0], textEvidence: '对中断原因的概括' }] } }, true)?.at).toBe(state.events.visitor.startAt);
    expect(() => validateTimeCommands(state, selected, [{ ...commands[0], worldClock: '2027-01-01T08:00:00+08:00' }])).toThrow();
  });
  it('开局不加载普通预检，不强制开局补写时间记录；旧正文可读且不伪造预检记录', async () => {
    const state = sleepingState();
    const prompt = await composePrompt({ state, stage: 'story', mode: 'opening', userInput: '等两天', settings: defaultSettings() });
    expect(prompt.context.TIME_PREFLIGHT).toBeUndefined();
    const selected = draft(state); selected.story!.variableGuide = [];
    expect(timeOutcome(state, selected)).toBeUndefined(); expect(timeOutcome(state, { ...selected, turnKind: 'opening' }, true)).toBeUndefined();
  });
});

it('中文时间无需词法门槛；无明确结构化中断时不以玩家目标强制限制耗时', () => {
  const state = visitor(), selected = draft(state, undefined, true), evidence = '凌晨三点，已约定访客敲门声将你唤醒。';
  selected.story!.narrative = evidence; selected.story!.variableGuide[0].textEvidence = evidence;
  const result = { commands: [{ type: 'SetWorldClock', commandId: 'chinese-time', worldClock: '2027-01-01T03:00:00+08:00', evidence }], rejectedSuggestions: [], unresolved: [] };
  expect(() => parseVariables(JSON.stringify(result), state, selected)).not.toThrow();
  selected.story!.variableGuide = [];
  expect(() => parseVariables(JSON.stringify(result), state, selected)).not.toThrow();
  expect(() => parseVariables(JSON.stringify({ ...result, commands: [{ ...result.commands[0], worldClock: '2027-01-01T09:00:00+08:00' }] }), state, selected)).not.toThrow();
});

it('预检保留ISO毫秒，不把思考未来或询问能力当成无条件长行动', () => {
  const state = sleepingState(); state.worldClock = '2026-12-31T23:00:00.250+08:00';
  expect(timePreflight(state, '等待一分钟').targetAt).toBe('2026-12-31T23:01:00.250+08:00');
  for (const action of ['我想到明早睡觉', '能等待两小时吗', '明天开始工作三小时']) expect(timePreflight(state, action).targetAt).toBeUndefined();
});
