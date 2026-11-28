import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createTurnDraft } from '../domain/drafts';
import { talentDefinitions } from '../domain/protagonist/talents';
import { AiClient } from '../services/ai/client';
import { payloadMessages, requestInspections } from '../services/ai/inspection';
import { stageResponses } from '../services/ai/stageResponses';
import { SaveRepository } from '../services/storage/saveRepository';
import { TurnCoordinator } from '../workflows/turnCoordinator';
import { sentContext } from './fixtures/contextAssertions';
import { talentPromptInput, talentScenario, emptyTalentWorld } from './fixtures/talentPrompt';
import { talentAi, talentJson, talentStory, talentSse } from './fixtures/talentAi';
import { talentRoutes } from './fixtures/talentRoutes';
import { variableTextEnvelope } from './fixtures/variableReply';
import { proof } from './fixtures/world';
import { gameTime } from './fixtures/game';
import { completeDraft } from './fixtures/turn';
import type { TalentId } from '../domain/protagonist/talents';

afterEach(() => { vi.restoreAllMocks(); stageResponses.clear(); requestInspections.clear(); });

async function setup(id: TalentId = 'cyber_tyrant', action = talentScenario, stake = false, failure?: 'variables' | 'world') {
  const repo = await SaveRepository.open('talent-workflow', new IDBFactory()), options = talentAi();
  const input = talentPromptInput('story', 'opening', id); input.state.economy.cash = 1_000_000;
  await repo.create(input.state);
  const draft = createTurnDraft('save-a', 0, 'talent-pipeline', 'opening', action); await repo.saveDraft(draft, null);
  const narrative = `经过一分钟，主角保持审慎。${stake ? '你按照自己的明确选择支付8000元保证金；失败可能失去这笔钱，潜在收益仍未实现，罕见的重组谈判机会尚无确定结局。' : talentRoutes[id].narrative}`;
  const calls: { stage: string; context: Record<string, unknown> }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init!.body)), stage = body.model as string, context = sentContext(payloadMessages(body, 'deepseek'));
    calls.push({ stage, context });
    const text = stage === 'story' ? talentStory(narrative)
      : stage === 'entities' ? variableTextEnvelope('<命令></命令>')
      : stage === 'variables' ? variableTextEnvelope(`<命令>set worldClock = "2026-10-18T08:01:00+08:00"\nset protagonist.emotionText = "审慎"${stake ? '\nadd economy.cash = -800000' : ''}${failure === 'variables' ? '\nset protagonist.talentId = "underworld_aura"' : ''}</命令>`)
        : JSON.stringify({ worldCommands: [{ type: 'UpdateNpc', commandId: 'world-intent', npcId: 'npc-a', expectedRevision: 0,
          changes: failure === 'world' ? { talentId: 'underworld_aura' } : {}, activeGoals: ['核对物流企业公开资料，之后自主决定是否提出接触'],
          evidence: proof({ kind: 'planned', at: gameTime, fact: '周衡计划核对企业公开资料，之后自主决定是否接触。', rationale: '源于寻找合作对象的既有目标；尚未接触、效忠或获知私人事实。' }) }], taskCommands: [], eventCommands: [], visibleHooks: [], unresolved: [] });
    return stage === 'story' && options.settings.runtime.streamStory ? talentSse(text) : talentJson('deepseek', text);
  });
  const coordinator = new TurnCoordinator(repo, new AiClient(fetcher));
  return { repo, options, draft, coordinator, fetcher, calls, narrative };
}
async function dispose(test: Awaited<ReturnType<typeof setup>>) { test.coordinator.dispose(); test.repo.close(); }

it.each(talentDefinitions)('$name：同一危机的独有 Mock 路径进入真实三阶段，机会不自动兑换奖励', async definition => {
  const test = await setup(definition.id);
  try {
    if (definition.id === 'cyber_tyrant') test.options.settings.runtime.streamStory = true;
    const original = await test.repo.load('save-a'), reading: string[] = [];
    const outcome = await test.coordinator.generate({ ...test.options, draft: test.draft, onProgress: p => { if (p.narrative) reading.push(p.narrative); } });
    expect(outcome.status).toBe('complete'); expect(test.calls.map(c => c.stage)).toEqual(['story', 'entities', 'variables', 'world']);
    for (const row of test.calls) expect(row.context.PROTAGONIST_TALENT).toMatchObject({ stage: row.stage, definition });
    expect(outcome.draft.story!.narrative).toBe(test.narrative);
    expect(await test.repo.load('save-a')).toEqual(original);
    const input = { draft: outcome.draft, nextAction: '', useVariableStage: true, useWorldStage: true };
    const committed = await test.repo.commitTurn(input);
    expect(committed.state.protagonist.talentId).toBe(definition.id); expect(committed.state.protagonist.emotionText).toBe('审慎');
    expect(committed.state.economy).toEqual(original.economy); expect(committed.state.items).toEqual(original.items);
    expect(committed.state.organizations).toEqual(original.organizations);
    expect(committed.state.protagonist.profession).toBe(original.protagonist.profession);
    expect(committed.state.npc['npc-a'].affinity).toBe(original.npc['npc-a'].affinity);
    expect(committed.state.npc['npc-a'].relationshipText).toBe(original.npc['npc-a'].relationshipText);
    expect(Object.keys(committed.state.npc)).toEqual(Object.keys(original.npc));
    if (committed.state.npc['npc-a'].kind === 'special') expect(committed.state.npc['npc-a'].activeGoals).toEqual(['核对物流企业公开资料，之后自主决定是否提出接触']);
    expect((await test.repo.commitTurn(input)).replayed).toBe(true); expect(test.fetcher).toHaveBeenCalledTimes(4);
    if (definition.id === 'cyber_tyrant') expect(reading.some(text => text.length > 0 && text.length < test.narrative.length)).toBe(true);
    // Opening turns are intentionally not undoable. Establish the existing regular
    // turn recovery point with the approved fixture, without another model request.
    await test.repo.bindTurnAction(committed.draft, '继续查阅', true, true);
    const nextDraft = await completeDraft(test.repo, { narrative: '主角继续查阅资料，没有作出新承诺。', summary: '继续查阅', variables: { commands: [], rejectedSuggestions: [], unresolved: [] }, world: emptyTalentWorld });
    const next = await test.repo.commitTurn({ draft: nextDraft, nextAction: '', useVariableStage: true, useWorldStage: true });
    const undone = await test.repo.undoTurn({ saveId: 'save-a', expectedRevision: next.state.revision, expectedDraft: next.draft, operationId: 'talent-undo' });
    expect(undone.state.protagonist.talentId).toBe(definition.id); expect(undone.state.turnNumber).toBe(1);
    expect(undone.state.economy).toEqual(original.economy); expect(test.fetcher).toHaveBeenCalledTimes(4);
  } finally { await dispose(test); }
});

it('八条示例路径并非换称号的同一结果；Mock 本身不是实际模型效果证明', () => {
  expect(new Set(Object.values(talentRoutes).map(r => r.route)).size).toBe(8);
  expect(new Set(Object.values(talentRoutes).map(r => r.narrative)).size).toBe(8);
});

it('绝命赌徒主动押上真实筹码：只记录已支付保证金，不保证收益或虚构胜率', async () => {
  const action = '我主动用现有10000元现金中的8000元支付已谈明的重组保证金；失败可能损失8000元，成功才有争取重要合作的机会。我明确承担这个风险，不要求保证成功。';
  const test = await setup('desperate_gambler', action, true);
  try {
    const before = await test.repo.load('save-a'), outcome = await test.coordinator.generate({ ...test.options, draft: test.draft });
    const paid = outcome.draft.variables!.result.commands.filter(c => c.type === 'SpendFunds');
    expect(paid).toHaveLength(1); expect(paid[0]).toHaveProperty('amount', 800000);
    const result = await test.repo.commitTurn({ draft: outcome.draft, nextAction: '', useVariableStage: true, useWorldStage: true });
    expect(result.state.economy.cash).toBe(before.economy.cash! - 800000); expect(result.state.economy.incomes).toEqual(before.economy.incomes);
    expect(result.state.items).toEqual(before.items); expect(result.state.protagonist.talentId).toBe('desperate_gambler'); expect(test.fetcher).toHaveBeenCalledTimes(4);
    expect(test.narrative).not.toMatch(/\d+%/);
  } finally { await dispose(test); }
});

it.each(['variables', 'world'] as const)('%s 模型试图改写天赋会被跳过，其他合法结果仍可正式保存', async stage => {
  const test = await setup('golden_edict', talentScenario, false, stage);
  try {
    const original = await test.repo.load('save-a');
    const completed = await test.coordinator.generate({ ...test.options, draft: test.draft });
    expect(await test.repo.load('save-a')).toEqual(original);
    expect(completed.draft.stageStatus[stage]).toBe('ready');
    expect(completed.draft[stage]?.result.settlement?.skipped).toHaveLength(1);
    const saved = await test.repo.commitTurn({draft:completed.draft,nextAction:'',useVariableStage:true,useWorldStage:true});
    expect(saved.state.protagonist.talentId).toBe('golden_edict');
    expect(test.fetcher).toHaveBeenCalledTimes(4);
  } finally { await dispose(test); }
});

it.each(['CAS', 'IDB'] as const)('带天赋候选遇到 %s 故障，不能部分提交或增加模型请求', async kind => {
  const test = await setup();
  try {
    const outcome = await test.coordinator.generate({ ...test.options, draft: test.draft });
    if (kind === 'CAS') await test.repo.save('save-a', 0, 'other-tab', [{ type: 'UpdateProtagonist', commandId: 'health', protagonistId: 'hero', expectedRevision: 0, changes: { healthText: '另一标签的合法变更' }, evidence: '测试并发' }]);
    const before = await test.repo.exportRaw('save-a');
    if (kind === 'IDB') {
      const put = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
        if (this.name === 'saves') throw new DOMException('synthetic-quota', 'QuotaExceededError');
        return put.apply(this, args);
      });
    }
    await expect(test.repo.commitTurn({ draft: outcome.draft, nextAction: '', useVariableStage: true, useWorldStage: true })).rejects.toBeDefined();
    expect(await test.repo.exportRaw('save-a')).toEqual(before); expect(test.fetcher).toHaveBeenCalledTimes(4);
  } finally { await dispose(test); }
});

it('取消天赋请求后迟到响应不形成正文候选，正式状态不变且没有自动重发', async () => {
  const test = await setup(); let deliver!: (value: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(resolve => { deliver = resolve; }));
  const coordinator = new TurnCoordinator(test.repo, new AiClient(fetcher));
  try {
    const original = await test.repo.load('save-a'), pending = coordinator.generate({ ...test.options, draft: test.draft });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); expect(coordinator.cancel()).toBe(true);
    deliver(talentJson('deepseek', talentStory(test.narrative))); await rejected;
    expect((await test.repo.loadDraft('save-a'))?.story).toBeUndefined(); expect(await test.repo.load('save-a')).toEqual(original); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { coordinator.dispose(); await dispose(test); }
});
