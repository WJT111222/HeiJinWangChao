import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { composePrompt } from '../prompts/composer';
import { parseTextVariables, parseWorld } from '../services/validation/aiOutputs';
import { runtimeLogEvent } from '../ui/game/runtimeLog';
import { defaultSettings } from '../ui/settings/model';
import { WorldResultSchema, createTurnDraft, rerollStory } from '../domain/drafts';
import { projectTurn } from '../domain/turnProjection';
import { gameTime, event, story, task, organizations } from './fixtures/game';
import { worldState, worldDraft, worldResult, projectedTime } from './fixtures/world';

// 根据用户确认的错误形态构造的中性案例，不是原始输出，也不与实机日志 ID 配对。
const block = (commands: string) => `<thinking>处理已选正文。</thinking><说明>本轮状态变化。</说明><命令>\n${commands}\n</命令>`;
const set = (path: string, value: unknown) => `set ${path} = ${JSON.stringify(value)}`;
const push = (path: string, value: unknown) => `push ${path} = ${JSON.stringify(value)}`;
function variables() {
  const state = worldState(), draft = worldDraft(false, 'opening');
  return { state, draft };
}
const memory = { text: '得知同事本周负责值班', knowledgeKind: 'reported', knowledgeSource: '当面告知', visibility: 'npc_private' };

// 旧拒绝本身应保留，修复的是请求契约和失败诊断，不是静默容错。
describe('已知协议混用的同类复现', () => {
  it('存档 knownInformation 格式不能充当文本输入；合法四字段可落账且不传播', async () => {
    const { state, draft } = variables(), before = structuredClone(state);
    const storedValue = { text: memory.text, source: memory.knowledgeSource, learnedAt: gameTime };
    await expect(parseTextVariables(block(push('npc[scene].knownInformation', storedValue)), state, draft))
      .rejects.toMatchObject({ code: 'schema_fields', details: { commandIndex: 0, valuePath: 'npc[id].knownInformation.knowledgeKind' } });
    const result = await parseTextVariables(block(push('npc[scene].knownInformation', memory)), state, draft);
    const projected = projectTurn(state, { ...draft, variables: { storyRevision: 1, candidateRevision: 1, requestRevision: 0, validation: 'validated', result } });
    expect(projected.npc.scene.knownInformation).toEqual([{ text: '[转述]' + memory.text, source: memory.knowledgeSource, learnedAt: gameTime }]);
    expect(projected.npc.scene.memories).toHaveLength(1); expect(projected.npc['npc-a']).toEqual(state.npc['npc-a']);
    expect(state).toEqual(before);
  });
  it('时间线对象被结构拒绝；significant 的真实终态也不能假装 major，空数组可继续', () => {
    const state = worldState(), draft = worldDraft();
    const raw = { ...worldResult(), timelineCandidates: [{ eventId: 'finished', title: '普通结案' }] };
    expect(() => parseWorld(JSON.stringify(raw), state, draft)).toThrow();
    try { parseWorld(JSON.stringify(raw), state, draft); } catch (error) {
      expect(error).toMatchObject({ code: 'schema_fields', details: { fieldPath: 'timelineCandidates.0', worldRule: 'schema' } });
      expect(runtimeLogEvent(1, 'world', 'failed', error).commandIndex).toBeUndefined();
    }
    const result = worldResult();
    result.eventCommands = [{ type: 'SaveEvent', commandId: 'finish', evidence: '事务已结束', event: {
      ...event('finished'), impact: 'significant', status: 'resolved', resolvedAt: projectedTime,
      resolutionText: '完成日常协调', outcome: 'success', continuation: { direction: 'end', reason: '自然结束' },
    } }];
    result.timelineCandidates = ['finished'];
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow(expect.objectContaining({ details: expect.objectContaining({ worldRule: 'timeline_state' }) }));
    result.timelineCandidates = [];
    expect(parseWorld(JSON.stringify(result), state, draft).timelineCandidates).toEqual([]);
    if (result.eventCommands[0].type === 'SaveEvent') result.eventCommands[0].event.impact = 'major';
    result.timelineCandidates = ['finished'];
    expect(parseWorld(JSON.stringify(result), state, draft).timelineCandidates).toEqual(['finished']);
  });
  it('World 新组织历史非空被拒绝；空历史加独立关系命令可通过', () => {
    const state = worldState(), draft = worldDraft(), result = worldResult([
      { type: 'CreateOrganization', commandId: 'org-create', evidence: '记录社区服务组织', organization: organizations[2] },
    ]);
    expect(() => parseWorld(JSON.stringify(result), state, draft)).toThrow(expect.objectContaining({ code: 'permission', details: expect.objectContaining({ worldRule: 'organization_initialization', commandIndex: 0, commandType: 'CreateOrganization' }) }));
    const first = result.worldCommands[0];
    if (first.type !== 'CreateOrganization') throw new Error('fixture');
    first.organization.relationHistory = [];
    result.worldCommands.push({ type: 'RecordOrgRelation', commandId: 'org-relation', organizationId: 'org-a', relation: '业务往来', reason: '已登记业务关系', evidence: '已有往来' });
    expect(parseWorld(JSON.stringify(result), state, draft).worldCommands).toHaveLength(2);
  });
});

describe('实际 Composer 输出契约', () => {
  it.each(['opening', 'regular'] as const)('%s 共享文本协议明确知晓信息与只读存档格式的区别，即使没选NPC组', async mode => {
    const state = worldState(), draft = worldDraft(false, mode);
    const prompt = await composePrompt({ stage: 'variables', mode, state, draft, settings: defaultSettings(), userInput: '', domains: ['protagonist'] });
    const systems = prompt.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    expect(systems).toContain('source/learnedAt');
    expect(systems).toContain('push npc[lin].knownInformation = {"text":"得知值班安排","knowledgeKind":"reported","knowledgeSource":"当面告知","visibility":"npc_private"}');
    expect(systems).toContain('先输出 set worldClock');
  });
  it.each(['opening', 'regular'] as const)('%s World 顶层数组及创建约束出现在真实请求中', async mode => {
    const state = worldState(), draft = worldDraft(true, mode);
    const prompt = await composePrompt({ stage: 'world', mode, state, draft, settings: defaultSettings(), userInput: '' });
    const context = prompt.context.COMMAND_CATALOG as Record<string, unknown>;
    expect(context).toHaveProperty('outputFields.timelineCandidates', z.toJSONSchema(WorldResultSchema.shape.timelineCandidates, { target: 'draft-7', unrepresentable: 'any' }));
    const systems = prompt.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    expect(systems).toContain('事件ID字符串数组'); expect(systems).toContain('significant');
    expect(systems).toContain('relationHistory=[]');
    expect(JSON.stringify(prompt.context)).toContain('"maxItems":0');
  });
});

describe('时间规则的确定归因，不推测用户实机根因', () => {
  it.each([
    ['clock_reversed', set('worldClock', '2026-10-18T07:00:00+08:00'), 'SetWorldClock'],
    ['npc_interaction_time', set('npc[scene].lastInteractionAt', '2026-10-18T09:00:00+08:00'), 'UpdateNpc'],
    ['income_received_future', set('economy.incomes[pay]', { source: '本次报酬', amount: 100, status: 'received', account: 'cash', receivedAt: projectedTime }), 'ReceiveIncome'],
  ])('%s 精确指向第2条，整批不写入', async (domainRule, command, commandType) => {
    const { state, draft } = variables(), before = structuredClone(state);
    const promise = parseTextVariables(block(set('protagonist.emotionText', '放松') + '\n' + command), state, draft);
    await expect(promise).rejects.toMatchObject({ code: 'time_data', details: { domainRule, commandIndex: 1, commandType } });
    await promise.catch(error => {
      const log = runtimeLogEvent(1, 'variables', 'failed', error);
      expect(log).toMatchObject({ commandIndex: 2, domainRule, commandType });
      expect(log.relatedCommandIndices).toBeUndefined(); expect(log.relatedNpcId).toBeUndefined();
      expect(log.message).not.toContain('放松');
    });
    expect(state).toEqual(before);
  });
  it('普通回合沿用时钟优先规范化；超出最终时钟的互动仍指向原文本位置', async () => {
    const state = worldState(); state.turnNumber = 1; state.journal = [{ turnId: 'past', revision: 0, story, relatedActorRefs: [] }];
    const draft = worldDraft(false), clock = set('worldClock', projectedTime), interaction = set('npc[scene].lastInteractionAt', projectedTime);
    expect((await parseTextVariables(block(interaction + '\n' + clock), state, draft)).commands.map(c => c.type)).toEqual(['SetWorldClock', 'UpdateNpc']);
    await expect(parseTextVariables(block(set('npc[scene].lastInteractionAt', '2026-10-18T10:00:00+08:00') + '\n' + clock), state, draft)).rejects.toMatchObject({ details: { domainRule: 'npc_interaction_time', commandIndex: 0 } });
    expect((await parseTextVariables(block(clock + '\n' + interaction), state, draft)).commands).toHaveLength(2);
  });
  it('开局系统时钟没有文本序号，随后失败命令仍映射到正确文本位置', async () => {
    const state = worldState(); state.openingTimePending = true; state.worldClock = '0001-01-01T00:00:00+08:00';
    const draft = rerollStory(createTurnDraft(state.saveId, 0, 'opening', 'opening', ''), { ...story, turnKind: 'opening', variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: gameTime, endAt: projectedTime }) }] });
    await expect(parseTextVariables(block(set('npc[scene].lastInteractionAt', '2026-10-18T10:00:00+08:00')), state, draft))
      .rejects.toMatchObject({ details: { domainRule: 'npc_interaction_time', commandIndex: 0, commandType: 'UpdateNpc' } });
  });
  it('NPC 互动早于自身上次互动仍拒绝，不误称为时钟倒退', async () => {
    const { state, draft } = variables();
    state.npc.scene.lastInteractionAt = gameTime;
    await expect(parseTextVariables(block(set('npc[scene].lastInteractionAt', '2026-10-18T07:00:00+08:00')), state, draft))
      .rejects.toMatchObject({ code: 'time_data', details: { domainRule: 'npc_interaction_time', commandIndex: 0 } });
  });
  it('开局模型时钟不同于 Story 候选，指出实际文本命令且不改写正式占位时间', async () => {
    const state = worldState(); state.openingTimePending = true; state.worldClock = '0001-01-01T00:00:00+08:00';
    const before = structuredClone(state);
    const draft = rerollStory(createTurnDraft(state.saveId, 0, 'opening', 'opening', ''), { ...story, turnKind: 'opening', variableGuide: [{ group: 'time', subjectHint: 'time:opening', observedFact: JSON.stringify({ startAt: gameTime, endAt: projectedTime }) }] });
    await expect(parseTextVariables(block(set('protagonist.emotionText', '平静') + '\n' + set('worldClock', gameTime)), state, draft))
      .rejects.toMatchObject({ code: 'time_data', details: { domainRule: 'opening_clock_conflict', commandIndex: 1, commandType: 'SetWorldClock' } });
    expect(state).toEqual(before);
  });
  it('开局预期收入早于候选时钟准确归因，不把预期收入当成实际到账', async () => {
    const { state, draft } = variables(); state.openingInitializationPending = true;
    const before = structuredClone(state);
    await expect(parseTextVariables(block(set('opening.initialState', { expectedIncomes: [{ id: 'pay', source: '工资', amount: 10000, status: 'expected', account: 'cash', expectedAt: '2026-10-18T07:00:00+08:00', scheduleText: '每月支付' }] })), state, draft))
      .rejects.toMatchObject({ code: 'time_data', details: { domainRule: 'opening_income_past', commandIndex: 0, commandType: 'InitializeOpeningState' } });
    expect(state).toEqual(before);
  });
  it('整批状态时间范围无单条执行错误时不得编造命令编号', async () => {
    const { state, draft } = variables();
    const { id: _id, ...fields } = task(); void _id;
    try {
      await parseTextVariables(block(set('protagonist.emotionText', '平静') + '\n' + set('tasks[local]', { ...fields, dueAt: '2026-10-18T07:00:00+08:00' })), state, draft);
      expect.fail('应拒绝倒置时间范围');
    } catch (error) {
      expect(error).toMatchObject({ code: 'time_data', details: { domainRule: 'state_time_range', relatedCommandIndices: [1, 2] } });
      expect(runtimeLogEvent(1, 'variables', 'failed', error).commandIndex).toBeUndefined();
    }
  });
});
