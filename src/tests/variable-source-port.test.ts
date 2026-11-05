import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createTurnDraft, rerollStory } from '../domain/drafts';
import { parseVariableText } from '../parsers/variableText';
import { compileVariableCommands, simulateVariablePlan } from '../executors/variableText';
import { parseTextVariables } from '../services/validation/aiOutputs';
import { safeAiError } from '../services/ai/errors';
import { VariableStage } from '../workflows/variableStage';
import { AiClient } from '../services/ai/client';
import { SaveRepository } from '../services/storage/saveRepository';
import { defaultAiConfig, newChannel } from '../services/ai/configuration';
import { CredentialVault } from '../services/ai/credentials';
import { defaultSettings } from '../ui/settings/model';
import { worldState } from './fixtures/world';
import { story } from './fixtures/game';

const reply = (commands = '') => `<thinking>本轮变量变化分析结果：保持未变字段。</thinking>\n<说明>\n- 按已选正文更新状态。\n</说明>\n<命令>\n${commands}\n</命令>`;
function fixture() {
  const state = worldState(); state.protagonist.skills = ['急救', '驾驶', '烹饪'];
  const draft = rerollStory(createTurnDraft(state.saveId, state.revision, 'source-port', 'opening', '观察周围'), { ...story, turnKind: 'opening' });
  return { state, draft };
}
async function simulate(text: string) {
  const { state, draft } = fixture(), before = structuredClone(state), ast = parseVariableText(reply(text));
  expect(ast.ok).toBe(true); if (!ast.ok) throw Error('parser');
  const context = { draft, expectedRevision: state.revision }, plan = await compileVariableCommands(ast.value, state, context);
  expect(plan.ok).toBe(true); if (!plan.ok) throw Error(plan.error.code);
  const result = await simulateVariablePlan(plan.value, state, context);
  expect(result.ok).toBe(true); expect(state).toEqual(before);
  if (!result.ok) throw Error(result.error.code);
  return result.value;
}
afterEach(() => vi.restoreAllMocks());
describe('源仓库标准Variables协议：先复现缺口', () => {
  it('delete没有操作数，与源标准文本体例一致', () => {
    const parsed = parseVariableText(reply('delete protagonist.skills[2]'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value[0]?.operation).toBe('delete');
  });
  it('技能数组按文本顺序push，并按倒序索引delete', async () => {
    const state = await simulate('push protagonist.skills = "游泳"\ndelete protagonist.skills[2]\ndelete protagonist.skills[0]');
    expect(state.protagonist.skills).toEqual(['驾驶', '游泳']);
  });
  it.each(['<命令></命令>', '<说明>无需变化</说明><命令></命令>', '<thinking>分析</thinking><命令></命令>'])('正式响应缺少三标签之一不能当成功：%s', async text => {
    const { state, draft } = fixture();
    await expect(parseTextVariables(text, state, draft)).rejects.toMatchObject({ code: 'variable_text_syntax' });
  });
  it('完整三区块与空命令保持合法，不把说明写入事实', async () => {
    const { state, draft } = fixture(); const parsed = await parseTextVariables(reply(), state, draft);
    expect(parsed.commands).toEqual([]);
  });
  it('候选保存QuotaExceededError不能压缩成unknown', async () => {
    const repo = await SaveRepository.open('source-storage', new IDBFactory()); const { state, draft } = fixture();
    await repo.create(state);
    await repo.saveDraft(createTurnDraft(state.saveId, state.revision, draft.turnId, 'opening', draft.userInput), null);
    await repo.saveDraft(draft, 0);
    const original = repo.saveDraft.bind(repo);
    vi.spyOn(repo, 'saveDraft').mockImplementation(async (next, expected, signal) => {
      if (next.stageStatus.variables === 'ready') throw new DOMException('private storage detail', 'QuotaExceededError');
      return original(next, expected, signal);
    });
    const config = defaultAiConfig(), channel = newChannel(); channel.defaultModel = 'mock-model'; config.channels = [channel]; config.routes.story = { channelId: channel.id, modelId: '' };
    const data = new Map<string, string>(), store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
    const vault = new CredentialVault(store, store); vault.set(channel.id, 'mock-secret');
    const runner = new VariableStage(repo, new AiClient(async () => Response.json({ choices: [{ message: { content: reply() }, finish_reason: 'stop' }] })));
    try {
      let caught: unknown; try { await runner.generate({ draft, settings: defaultSettings(), config, vault }); } catch (e) { caught = e; }
      expect(safeAiError(caught)).toMatchObject({ code: 'storage', details: { variableStep: 'candidate_save' } });
      expect(JSON.stringify(safeAiError(caught))).not.toContain('private storage detail');
      expect(await repo.load(state.saveId)).toEqual(state); expect((await repo.loadDraft(state.saveId))?.story).toEqual(draft.story);
    } finally { runner.dispose(); repo.close(); }
  });
});

describe('源操作语义与有限领域适配', () => {
  it('set局部对象只合并领域白名单，既有身份和其他状态保留', async () => {
    const state = await simulate('set protagonist = {\n"healthText":"健康",\n"emotionText":"放松"\n}');
    expect(state.protagonist.healthText).toBe('健康'); expect(state.protagonist.emotionText).toBe('放松');
    expect(state.protagonist.id).toBe('hero'); expect(state.protagonist.skills).toEqual(['急救', '驾驶', '烹饪']);
  });
  it('支持源gameState.前缀；set数组索引、push后删除按实际顺序执行', async () => {
    const state = await simulate('SET gameState.protagonist.skills[1] = "骑行"\npush protagonist.skills = "游泳"\ndelete protagonist.skills[0]\ndelete protagonist.skills[1]');
    expect(state.protagonist.skills).toEqual(['骑行', '游泳']);
  });
  it('好感set/add由程序读取连续前值，保留关系字段及人物身份', async () => {
    const state = await simulate('set npc[npc-a].relationshipText = "同事"\nset npc[npc-a].affinity = 10\nadd npc[npc-a].affinity = -3');
    expect(state.npc['npc-a'].affinity).toBe(7); expect(state.npc['npc-a'].relationshipText).toBe('同事');
    expect(state.npc.scene.affinity).toBe(fixture().state.npc.scene.affinity);
  });
  it('特殊NPC目标数组可追加、改项、删除，不修改别人的记忆', async () => {
    const state = await simulate('set npc[npc-a].activeGoals[0] = "整理档案"\npush npc[npc-a].activeGoals = "准备考试"\ndelete npc[npc-a].activeGoals[0]');
    const person = state.npc['npc-a']; expect(person.kind === 'special' && person.activeGoals).toEqual(['准备考试']);
    expect(state.npc.scene.memories).toEqual([]);
  });
  it('物品最终数量和delete复用原数量归零及卸装备，不留下引用', async () => {
    const result = await simulate('set items[top] = {"name":"外衣","category":"top","quantity":2,"ownerRef":{"kind":"protagonist","id":"hero"},"conditionText":"完好"}\nset protagonist.currentWear.topItemId = "top"\nset items[top].quantity = 1\ndelete items[top]');
    expect(result.items.top).toBeUndefined(); expect(result.protagonist.currentWear.topItemId).toBeUndefined();
  });
  it('新数组操作精确重放不重复追加，同ID不同输入拒绝', async () => {
    const { state, draft } = fixture(), context = { draft, expectedRevision: state.revision };
    const ast = parseVariableText(reply('push protagonist.skills = "游泳"\ndelete protagonist.skills[0]')); if (!ast.ok) throw Error('parser');
    const plan = await compileVariableCommands(ast.value, state, context); if (!plan.ok) throw Error(plan.error.code);
    const first = await simulateVariablePlan(plan.value, state, context); if (!first.ok) throw Error(first.error.code);
    const replay = await compileVariableCommands(ast.value, first.value, context); expect(replay.ok).toBe(true);
    if (!replay.ok) throw Error(replay.error.code);
    expect(await simulateVariablePlan(replay.value, first.value, context)).toEqual(first);
    const different = parseVariableText(reply('push protagonist.skills = "攀岩"\ndelete protagonist.skills[0]')); if (!different.ok) throw Error('parser');
    expect(await compileVariableCommands(different.value, first.value, context)).toMatchObject({ ok: false, error: { code: 'duplicate_or_conflicting_command' } });
  });
  it.each(['delete npc[npc-a]', 'delete npc[npc-a].memories[0]', 'delete economy.incomes[old]', 'delete locations[chongqing]', 'set protagonist = {"id":"other"}', 'add npc[npc-a].affinity = 1000', 'delete protagonist.skills[99]'])('没有合法领域操作或非法数据整批拒绝：%s', async invalid => {
    const { state, draft } = fixture(), before = structuredClone(state), ast = parseVariableText(reply(`set protagonist.emotionText = "安心"\n${invalid}`));
    expect(ast.ok).toBe(true); if (!ast.ok) throw Error('parser');
    const compiled = await compileVariableCommands(ast.value, state, { draft, expectedRevision: state.revision });
    if (compiled.ok) expect((await simulateVariablePlan(compiled.value, state, { draft, expectedRevision: state.revision })).ok).toBe(false);
    else expect(compiled).not.toHaveProperty('value');
    expect(state).toEqual(before);
  });
});

describe('三标签严格失败与安全步骤诊断', () => {
  it.each([
    '<thinking>分析</thinking><说明>说明</说明>',
    '<thinking>分析</thinking><说明>说明</说明><命令>set protagonist.healthText = "健康"',
    '<thinking>分析</thinking><说明>说明</说明><命令>set protagonist.healthText = {</命令>',
    '<说明>说明</说明><thinking>分析</thinking><命令></命令>',
    '<thinking>分析</thinking><thinking>重复</thinking><说明></说明><命令></命令>',
    '<thinking>分析</thinking><说明></说明><命令></命令><命令></命令>',
  ])('缺失/顺序错误/重复/截断不能返回命令子集：%s', async text => {
    const { state, draft } = fixture(), before = structuredClone(state);
    await expect(parseTextVariables(text, state, draft)).rejects.toMatchObject({ code: 'variable_text_syntax' });
    expect(state).toEqual(before);
  });
  it('分析和说明中的示例不能执行，JSON字符串中的标签与转义保留', async () => {
    const { state, draft } = fixture();
    const text = '<thinking>示例<命令>delete npc[npc-a]</命令></thinking><说明>- set worldClock = "1900-01-01T00:00:00+08:00"</说明><命令>set protagonist.emotionText = ' + JSON.stringify('看到</命令>与"引号"') + '</命令>';
    const result = await parseTextVariables(text, state, draft);
    expect(result.commands).toHaveLength(1); expect(result.commands[0]).toMatchObject({ type: 'UpdateProtagonist', changes: { emotionText: '看到</命令>与"引号"' } });
  });
  it.each([
    ['set npc[unknown].healthText = "PRIVATE-SECRET"', 'mapping'],
    ['add economy.cash = -99999999', 'simulation'],
    ['set x = NaN', 'commands'],
  ])('错误能定位处理步骤并不复制非法值：%s', async (text, variableStep) => {
    const { state, draft } = fixture(); let caught: unknown;
    try { await parseTextVariables(reply(text), state, draft); } catch (error) { caught = error; }
    expect(safeAiError(caught)).toMatchObject({ details: { variableStep } });
    expect(JSON.stringify(safeAiError(caught))).not.toContain('PRIVATE-SECRET');
  });
  it('正式结算阶段的未知存储异常保留安全步骤，不覆盖World诊断', async () => {
    const { runtimeLogEvent } = await import('../ui/game/runtimeLog'); const { AiError } = await import('../services/ai/errors');
    const entry = runtimeLogEvent(1, 'commit', 'failed', new DOMException('private detail', 'QuotaExceededError'));
    expect(entry).toMatchObject({ code: 'storage', variableStep: 'commit' }); expect(JSON.stringify(entry)).not.toContain('private detail');
    expect(runtimeLogEvent(2, 'world', 'failed', new AiError('data_integrity', undefined, { worldRule: 'source_owner' }))).toMatchObject({ worldRule: 'source_owner' });
  });
});

it('未确认同伴的好感占位不能作为add的数值基线', async () => {
  const { state, draft } = fixture(); state.initialCompanionId = 'npc-a'; state.npc['npc-a'].affinity = 0; delete state.npc['npc-a'].affinityConfirmed;
  const before = structuredClone(state), ast = parseVariableText(reply('add npc[npc-a].affinity = 5')); if (!ast.ok) throw Error('parser');
  const result = await compileVariableCommands(ast.value, state, { draft, expectedRevision: state.revision });
  expect(result).toMatchObject({ ok: false, error: { code: 'type_mismatch' } }); expect(state).toEqual(before);
});
it('未确认同伴由模型set绝对好感后可在同批add，原from=null边界不变', async () => {
  const { state, draft } = fixture(); state.initialCompanionId = 'npc-a'; state.npc['npc-a'].affinity = 0; delete state.npc['npc-a'].affinityConfirmed;
  const ast = parseVariableText(reply('set npc[npc-a].affinity = 2\nadd npc[npc-a].affinity = 3')); if (!ast.ok) throw Error('parser');
  const context = { draft, expectedRevision: state.revision }, plan = await compileVariableCommands(ast.value, state, context); if (!plan.ok) throw Error(plan.error.code);
  expect(plan.value.commands[0]).toMatchObject({ type: 'UpdateNpc', affinityChange: { from: null, to: 2 } });
  const result = await simulateVariablePlan(plan.value, state, context); if (!result.ok) throw Error(result.error.code);
  expect(result.value.npc['npc-a'].affinity).toBe(5); expect(result.value.npc['npc-a'].affinityConfirmed).toBe(true);
});
