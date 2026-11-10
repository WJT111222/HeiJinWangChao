import { describe, expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { array, record } from '../services/ai/protocols';
import { recallBudget } from '../domain/memories/recall';
import { longCompanionRecallFixture, addCompanionBackgroundEvent } from './fixtures/longCompanionRecall';
import { sentContext, expectWorldWithNpcProjection } from './fixtures/contextAssertions';
import type { AiStage } from '../services/ai/configuration';

const results = (context: Record<string, unknown>) => array(record(context.MEMORY_CONTEXT).recalledTurns).map(record);
const size = (value: unknown) => JSON.stringify(value).replace(/[<>&]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).length;
async function compose(a: ReturnType<typeof longCompanionRecallFixture>, stage: AiStage, action: string) {
  a.draft.userInput = action;
  const before = structuredClone(a);
  const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: action });
  const context = sentContext(prompt.messages), turns = results(context);
  expect(a).toEqual(before); expectWorldWithNpcProjection(context, a.state);
  expect(array(record(context.MEMORY_CONTEXT).recentTurns).map(entry => record(entry).turnId)).toEqual(['companion-298', 'companion-299', 'companion-300']);
  expect(new Set(turns.map(entry => entry.turnId)).size).toBe(turns.length);
  expect(turns.some(entry => ['companion-298', 'companion-299', 'companion-300'].includes(String(entry.turnId)))).toBe(false);
  expect(size(turns)).toBeLessThanOrEqual(recallBudget.serializedCharacters);
  for (const turn of turns) {
    const original = a.state.journal.find(entry => entry.turnId === turn.turnId)!;
    const range = record(turn.narrativeRange);
    expect(turn).toMatchObject({ source: 'journal', status: 'committed', revision: original.revision });
    expect(turn.narrativeExcerpt).toBe(original.story.narrative.slice(Number(range.start), Number(range.end)));
    expect(['strong', 'auxiliary']).toContain(turn.relevance); expect(Array.isArray(turn.sourceReferences)).toBe(true);
  }
  if (process.env.RECALL_METRICS === '1') console.info('companion-recall-volume', JSON.stringify({ stage, action,
    ids: turns.map(turn => turn.turnId), strong: turns.filter(turn => turn.relevance === 'strong').length,
    recallCharacters: size(turns), ...contextStatistics(prompt.messages) }));
  return { turns, context };
}

describe('300回合长期同行NPC：最终messages准入与两条来源路径', () => {
  it.each(['和她去吃早餐。', '和她一起散步。', '找她聊聊。', '找林晚聊聊。'])('普通行动%s不把共同日常填满旧史预算', async action => {
    const a = longCompanionRecallFixture();
    expect(a.state.journal.filter(entry => entry.relatedActorRefs.some(ref => ref.id === 'partner')).length).toBeGreaterThanOrEqual(250);
    const { turns } = await compose(a, 'story', action);
    expect(turns).toEqual([]);
  });
  it.each(['actor_only', 'owner_only', 'wide_only'] as const)('%s独立路径不能仅靠同一人物升级无关旧史', async path => {
    const a = longCompanionRecallFixture();
    if (path === 'actor_only') {
      a.state.npc.partner.memories = [];
      if (a.state.npc.partner.kind === 'special') a.state.npc.partner.longTermMemories = [];
      a.state.memories.npcSummaries = {};
    } else {
      a.state.journal.forEach(entry => { entry.relatedActorRefs = []; });
      if (path === 'wide_only') {
        a.state.npc.partner.memories = [];
        if (a.state.npc.partner.kind === 'special') a.state.npc.partner.longTermMemories = [];
        a.state.memories.npcSummaries.partner = a.state.memories.npcSummaries.partner.slice(-1);
      }
    }
    const { turns } = await compose(a, 'story', '和她去吃早餐。');
    expect(turns).toEqual([]);
  });
  it.each(['variables', 'world'] as const)('%s普通Story不因长期人物档案和宽summary生成伪当前话题', async stage => {
    const { turns } = await compose(longCompanionRecallFixture(), stage, '和她去吃早餐。');
    expect(turns).toEqual([]);
  });
  it.each([
    ['还记得我们第一次见面的那天吗？', [8]],
    ['我们当年那次争吵，后来是怎么和解的？', [120, 160]],
    ['说说修复旧屋的长期承诺，后来有什么变化？', [220, 280]],
  ] as const)('具体话题%s保留早期关键经过和必要后续', async (action, expected) => {
    const { turns } = await compose(longCompanionRecallFixture(), 'story', action);
    expect(turns.map(turn => turn.turnId)).toEqual(expect.arrayContaining(expected.map(number => `companion-${number}`)));
    expect(turns.length).toBeLessThanOrEqual(6);
    expect(turns.slice(0, expected.length).map(turn => turn.turnId)).toEqual(expect.arrayContaining(expected.map(number => `companion-${number}`)));
    expect(turns.filter(turn => expected.some(number => turn.turnId === `companion-${number}`)).every(turn => turn.relevance === 'strong')).toBe(true);
  });
  it('Variables从本轮Story和guide提及的承诺获得原约和变化，玩家无需先提旧事', async () => {
    const a = longCompanionRecallFixture();
    a.draft.story!.narrative += '林晚提起修复旧屋的长期承诺，以及材料运送受阻后的变化。';
    a.draft.story!.variableGuide = [{ group: 'npc', subjectHint: 'partner', observedFact: '核对修复旧屋承诺与推迟施工的历史依据。' }];
    const { turns } = await compose(a, 'variables', '和她去吃早餐。');
    expect(turns.map(turn => turn.turnId)).toEqual(expect.arrayContaining(['companion-220', 'companion-280']));
    expect(turns.length).toBeLessThanOrEqual(6);
  });
  it('World明确后台事件/任务来源不因同行NPC普遍度而失去因果原文', async () => {
    const a = addCompanionBackgroundEvent(longCompanionRecallFixture());
    const { turns, context } = await compose(a, 'world', '和她去吃早餐。');
    expect(turns.map(turn => turn.turnId)).toEqual(expect.arrayContaining(['companion-220', 'companion-280']));
    expect(turns.length).toBeLessThanOrEqual(6);
    expect(turns.filter(turn => ['companion-220', 'companion-280'].includes(String(turn.turnId))).every(turn => turn.relevance === 'strong')).toBe(true);
    expect(JSON.stringify(turns)).toContain('event.materials');
    expect(record(context.SAVE_STATE).revision).toBe(300);
  });
});
