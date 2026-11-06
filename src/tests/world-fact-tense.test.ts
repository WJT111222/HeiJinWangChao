import { describe, expect, it } from 'vitest';
import { parseWorld } from '../services/validation/aiOutputs';
import { readWorldEvidence, worldSources } from '../services/validation/worldEvidence';
import type { WorldEvidence } from '../services/validation/worldEvidence';
import { projectTurn } from '../domain/turnProjection';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { schoolContext, schoolEvidence, schoolResult, schoolTask, syntheticSchoolBatch } from './fixtures/worldChineseFact';

function parse(fact: string = schoolEvidence.fact) {
  const { state, draft } = schoolContext();
  return parseWorld(JSON.stringify(schoolResult(schoolTask(fact))), state, draft);
}

describe('World 中文事实性质：真实 evidence 与合成合法上下文', () => {
  it('真实迎检准备 evidence 通过来源读取、完整 World 校验与整批投影，正式状态不变', () => {
    const { state, draft } = schoolContext(), before = structuredClone(state), command = schoolTask();
    const sources = worldSources(projectTurn(state, draft), draft, state);
    expect(readWorldEvidence(command, sources, state.worldClock, schoolEvidence.at).proof.fact).toBe(schoolEvidence.fact);
    const result = parseWorld(JSON.stringify(schoolResult(command)), state, draft);
    expect(projectTurn(state, draft, result.taskCommands).tasks[command.task.id].status).toBe('active');
    expect(state).toEqual(before);
  });
  it.each([
    '学校正在进行迎检准备。',
    '管理层已经启动食堂检查准备工作。',
    '财务部门正在排查账目。',
    '企业正在执行既定整改计划。',
    '机构正在编制年度检查计划。',
    '车间已完成检修准备。',
    '准备工作已经启动。',
    '学校正在整理明天的检查材料。',
  ])('允许已经发生或正在进行的实际工作：%s', fact => expect(() => parse(fact)).not.toThrow());

  it.each([
    ['学校准备明天检查食堂。', 'fact_plan'],
    ['管理层计划下周整改。', 'fact_plan'],
    ['企业可能已经完成整改。', 'fact_uncertainty'],
    ['据说相关部门已经调查完毕。', 'fact_uncertainty'],
    ['学校准备完成整改。', 'fact_plan'],
    ['如果整改完成，学校将要恢复营业。', 'fact_plan'],
    ['不是学校已经完成整改。', 'fact_negated'],
    ['学校准备完成。', 'fact_plan'],
    ['企业已经计划下周整改。', 'fact_plan'],
    ['企业计划落实到位。', 'fact_plan'],
    ['学校正在进行迎检准备，计划明天检查。', 'fact_plan'],
    ['企业正在执行整改计划，可能已经完成。', 'fact_uncertainty'],
  ])('拒绝把计划、转述、推测或否定当作事实并诊断：%s', (fact, rule) => {
    let caught: unknown;
    try { parse(fact); } catch (error) { caught = error; }
    const logged = runtimeLogEvent(1, 'world', 'failed', caught);
    expect(logged).toMatchObject({ code: 'invalid_output', commandType: 'SaveTask', commandIndex: 1,
      fieldPath: 'taskCommands.0.evidence.fact', worldRule: rule });
    expect(JSON.stringify(logged)).not.toContain(fact);
    expect(JSON.stringify(logged)).not.toContain('org_school_38th');
  });

  const goalStatements = [
    '学校力保迎检准备落实到位。',
    '学校确保整改计划落实到位。',
    '学校保障整改计划落实到位。',
  ];
  it.each(goalStatements)('单独目标不能启动新任务：%s', fact => {
    expect(() => parse(fact)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'fact_plan' }) }));
  });
  it.each(goalStatements)('另一条合法任务不能替目标句背书场外已发生事件：%s', fact => {
    const { state, draft } = schoolContext(), before = structuredClone(state), batch = syntheticSchoolBatch();
    batch.eventCommands[0].evidence = JSON.stringify({ ...schoolEvidence, fact });
    expect(() => parseWorld(JSON.stringify(batch), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      worldRule: 'fact_plan', commandType: 'SaveEvent', fieldPath: 'eventCommands.0.evidence.fact',
    }) }));
    expect(state).toEqual(before);
  });
  it.each(['力保', '确保', '保障'])('实际行为后的同主语目标保留为目的，不否定已开展工作：%s', goal => {
    expect(parse(`学校正在排查账目，${goal}整改计划落实到位。`).taskCommands[0]).toMatchObject({ task: { status: 'active' } });
  });
  it('同一分句先启动工作再说明目的，不把目的动词一律禁用', () => {
    expect(() => parse('学校已经启动食堂检查准备工作以确保整改计划落实到位。')).not.toThrow();
  });
  it('保障部门作为主语名词，仍可描述真实正在执行的计划', () => {
    expect(() => parse('保障部门正在执行既定整改计划。')).not.toThrow();
  });
  it('不能因保障后的工作名词而绕过实际执行要求', () => {
    expect(() => parse('学校保障工作落实到位。')).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'fact_plan' }) }));
  });
  it.each(goalStatements)('实际工作不能把另一个仅有目标的outcome洗成已完成结果：%s', outcome => {
    const { state, draft } = schoolContext(), command = schoolTask();
    command.task.status = 'completed';
    command.evidence = JSON.stringify({ ...schoolEvidence, outcome });
    expect(() => parseWorld(JSON.stringify(schoolResult(command)), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      worldRule: 'fact_plan', fieldPath: 'taskCommands.0.evidence.outcome',
    }) }));
    expect(state.tasks).toEqual({});
  });
  it.each([
    '学校正在排查账目。确保整改计划落实到位。',
    '学校正在排查账目，其他企业确保整改计划落实到位。',
  ])('不跨句或向另一个显式主体借执行依据：%s', fact => {
    expect(() => parse(fact)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'fact_plan' }) }));
  });

  const futureActions = [
    '学校将进行迎检准备。',
    '学校会开展迎检准备工作。',
    '管理层将启动财务排查。',
    '公司会执行整改计划。',
    '学校会进行迎检准备。',
    '工会会开展迎检准备工作。',
    '学校将不再开展迎检准备工作。',
  ];
  it.each(futureActions)('未来助动词不能支持active任务：%s', fact => {
    expect(() => parse(fact)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      worldRule: 'fact_plan', commandType: 'SaveTask', fieldPath: 'taskCommands.0.evidence.fact',
    }) }));
  });
  it.each(futureActions)('未来助动词不能支持active事件：%s', fact => {
    const { state, draft } = schoolContext(), before = structuredClone(state), batch = syntheticSchoolBatch();
    batch.eventCommands[0].evidence = JSON.stringify({ ...schoolEvidence, fact });
    expect(() => parseWorld(JSON.stringify(batch), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      worldRule: 'fact_plan', commandType: 'SaveEvent', fieldPath: 'eventCommands.0.evidence.fact',
    }) }));
    expect(state).toEqual(before);
  });
  it.each(futureActions)('未来动作不能成为completed的outcome：%s', outcome => {
    const { state, draft } = schoolContext(), command = schoolTask('管理层完成了资料核查。');
    command.task.status = 'completed';
    command.evidence = JSON.stringify({ ...schoolEvidence, fact: '管理层完成了资料核查。', outcome });
    expect(() => parseWorld(JSON.stringify(schoolResult(command)), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({
      worldRule: 'fact_plan', fieldPath: 'taskCommands.0.evidence.outcome',
    }) }));
    expect(state.tasks).toEqual({});
  });
  it.each([
    '学校将继续进行迎检准备。',
    '学校会逐步开展迎检准备工作。',
    '学校将在校内进行迎检准备。',
    '学校已经启动检查，管理层会开展迎检准备工作。',
  ])('有界助动词修饰或其他已发生事实不能将未来动作变成事实：%s', fact => {
    expect(() => parse(fact)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'fact_plan' }) }));
  });
  it.each([
    '会议已经开始。',
    '会计部门正在排查账目。',
    '管理层已将材料提交。',
    '管理层已将启动方案提交。',
    '工会开展了迎检准备工作。',
    '协会执行了既定整改计划。',
    '工作人员已经学会开展检查。',
  ])('会的名词/词汇及将的已完成处置结构不是未来动作：%s', fact => expect(() => parse(fact)).not.toThrow());

  it('future/planned 仍可保存为未执行任务，不能伪装 active', () => {
    const { state, draft } = schoolContext(), command = schoolTask('学校准备明天检查食堂。');
    command.evidence = JSON.stringify({ ...schoolEvidence, kind: 'planned', fact: '学校准备明天检查食堂。' });
    command.task.status = 'planned';
    command.task.startAt = '2026-10-21T06:40:00.000Z';
    command.task.dueAt = '2026-10-21T08:00:00.000Z';
    expect(parseWorld(JSON.stringify(schoolResult(command)), state, draft).taskCommands[0]).toMatchObject({ task: { status: 'planned' } });
    command.task.status = 'active';
    expect(() => parseWorld(JSON.stringify(schoolResult(command)), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'task_state' }) }));
  });

  it.each([
    ['学校已经完成检查准备工作，核对清单已归档。', undefined],
    ['学校可能已经完成检查准备工作。', 'fact_uncertainty'],
    ['学校计划明天完成检查准备工作。', 'fact_plan'],
  ])('完成结果同样区分计划名词与真实推测：%s', (outcome, rule) => {
    const { state, draft } = schoolContext(), command = schoolTask('管理层完成了资料核查。');
    command.task.status = 'completed';
    command.evidence = JSON.stringify({ ...schoolEvidence, fact: '管理层完成了资料核查。', outcome });
    if (rule) expect(() => parseWorld(JSON.stringify(schoolResult(command)), state, draft)).toThrow(expect.objectContaining({
      details: expect.objectContaining({ worldRule: rule, fieldPath: 'taskCommands.0.evidence.outcome' }),
    }));
    else expect(parseWorld(JSON.stringify(schoolResult(command)), state, draft).taskCommands[0]).toMatchObject({ task: { status: 'completed' } });
  });

  it.each(['source', 'time', 'blocker', 'task-state'] as const)('名词识别不绕过既有 %s 校验', scenario => {
    const { state, draft } = schoolContext(), command = schoolTask();
    const evidence: WorldEvidence = { ...schoolEvidence, sources: [...schoolEvidence.sources] };
    let rule: string;
    if (scenario === 'source') { evidence.sources = ['org:missing']; rule = 'source_missing'; }
    else if (scenario === 'time') { command.task.startAt = '2026-10-20T07:00:00.000Z'; rule = 'task_state'; }
    else if (scenario === 'blocker') { command.task.blockers = ['未取得核查材料']; rule = 'completion_conditions'; }
    else { command.task.status = 'planned'; rule = 'task_state'; }
    command.evidence = JSON.stringify(evidence);
    expect(() => parseWorld(JSON.stringify(schoolResult(command)), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: rule }) }));
    expect(state.tasks).toEqual({});
  });

  it('真实 evidence + 两条明确标为合成的合法事件可以整批投影，不传播角色知识', () => {
    const { state, draft } = schoolContext(), before = structuredClone(state);
    const result = parseWorld(JSON.stringify(syntheticSchoolBatch()), state, draft);
    const next = projectTurn(state, draft, [...result.taskCommands, ...result.eventCommands]);
    expect(next.tasks.task_school_inspection.status).toBe('active');
    expect(next.events.school_accounts.status).toBe('active');
    expect(next.events.school_inspection.status).toBe('scheduled');
    expect(next.npc).toEqual(state.npc);
    expect(next.events.school_accounts.visibility).toBe('hidden');
    expect(state).toEqual(before);
  });

  it.each(['event-plan', 'event-time', 'event-source'] as const)('后续合成事件的 %s 独立失败且整批不污染输入', scenario => {
    const { state, draft } = schoolContext(), before = structuredClone(state), result = syntheticSchoolBatch();
    let rule: string;
    if (scenario === 'event-plan') { Reflect.deleteProperty(result.eventCommands[0].event, 'estimatedEndAt'); rule = 'event_plan'; }
    else if (scenario === 'event-time') { result.eventCommands[0].event.estimatedEndAt = '2026-10-20T06:39:00.000Z'; rule = 'event_time'; }
    else { result.eventCommands[1].evidence = JSON.stringify({ ...schoolEvidence, sources: ['org:missing'] }); rule = 'source_missing'; }
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: rule, commandType: 'SaveEvent' }) }));
    expect(state).toEqual(before);
  });
});
