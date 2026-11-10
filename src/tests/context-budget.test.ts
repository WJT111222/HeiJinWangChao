import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { inspectBudget, utf8Bytes, windowRisk, unknownWindowWarning } from '../prompts/budgetInspection';
import { contextV2Fixture } from './fixtures/contextV2';
import { contextScaleFixture } from './fixtures/contextScale';
import { longCompanionRecallFixture } from './fixtures/longCompanionRecall';
import { recallV2Fixture } from './fixtures/recallV2';
import { contextMessage } from '../prompts/context';

it.each(['story', 'variables', 'world'] as const)('%s final compose reconciles every serialized character and byte without mutation or API', async stage => {
  const a = contextV2Fixture(); const before = structuredClone(a); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  try {
    const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: a.draft.userInput });
    const report = inspectBudget(prompt.messages); const stats = contextStatistics(prompt.messages);
    expect(report.categories.reduce((sum, row) => sum + row.characters, 0)).toBe(stats.characters);
    expect(report.categories.reduce((sum, row) => sum + row.bytes, 0)).toBe(stats.contentBytes);
    expect(report.reconciliation.characters).toBe(0);
    expect(report.counts.npc).toBe(Object.keys(a.state.npc).length);
    expect(report.counts.npcMemories).toBeGreaterThan(100);
    expect(report.categories.find(row => row.id === 'system')!.characters).toBeGreaterThan(0);
    expect(report.duplicates.some(row => row.identity.startsWith('memory:'))).toBe(false);
    expect(fetcher).not.toHaveBeenCalled(); expect(a).toEqual(before);
  } finally { vi.unstubAllGlobals(); }
});

it('measures escaped Unicode, repeated same object references and actual serialization; does not merge different IDs semantically', () => {
  const entry = { id: 'n', name: '中🙂<&', onScene: true, background: 'x'.repeat(90) };
  const context = { SAVE_STATE: { npc: { n: entry } }, SCENE_NPCS: [entry, { ...entry, id: 'different' }] };
  const original = structuredClone(context); const messages = [{ role: 'user' as const, content: contextMessage(context) }];
  const report = inspectBudget(messages); const row = report.duplicates.find(row => row.identity === 'npc:n')!;
  expect(row.occurrences).toBe(2); expect(row.exactContent).toBe(true); expect(row.locations).toHaveLength(2);
  expect(row.extraCharacters).toBeGreaterThan(100); expect(report.duplicates.some(row => row.identity === 'npc:different')).toBe(false);
  expect(report.repeatedRepresentation.characters).toBe(row.extraCharacters);
  expect(report.categories.reduce((s, r) => s + r.bytes, 0)).toBe(utf8Bytes(messages[0].content));
  expect(context).toEqual(original);
});

it.each(['story', 'variables', 'world'] as const)('%s 300-turn breakfast recall remains quiet while every formal companion memory is retained', async stage => {
  const a = longCompanionRecallFixture(); const before = structuredClone(a);
  const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: a.draft.userInput });
  const report = inspectBudget(prompt.messages);
  expect(report.counts.npcMemories).toBe(302); expect(report.counts.recalled).toBeLessThanOrEqual(3);
  expect(JSON.stringify(prompt.messages)).toContain('正式私人资料标记');
  expect(report.categories.find(row => row.id === 'npcMemory')!.characters).toBeGreaterThan(10000);
  expect(a).toEqual(before);
});

it('long original recall retains ranges and budget diagnostics with query omissions and strong/auxiliary counts', async () => {
  const a = recallV2Fixture(); a.state.journal[7].story.narrative += '救助船夫的经过'.repeat(5000);
  a.draft.userInput = '张三和船夫旧约。'.repeat(3000);
  const prompt = await composePrompt({ ...a, stage: 'story', mode: 'regular', userInput: a.draft.userInput });
  const report = inspectBudget(prompt.messages); const memory = prompt.context.MEMORY_CONTEXT as { recalledTurns: { narrativeExcerpt: string; narrativeRange: { start: number; end: number }; turnId: string }[]; recallDiagnostics: { narrativeCharacters: number; serializedCharacters: number; truncatedCueCharacters: number[]; strongTurns: number; auxiliaryTurns: number } };
  expect(report.recall!.truncated).toBeGreaterThan(0);
  expect(memory.recallDiagnostics.truncatedCueCharacters[0]).toBeGreaterThan(0);
  expect(report.recall!.strong + report.recall!.auxiliary).toBe(memory.recalledTurns.length);
  expect(memory.recallDiagnostics.strongTurns + memory.recallDiagnostics.auxiliaryTurns).toBe(memory.recalledTurns.length);
  expect(memory.recallDiagnostics.narrativeCharacters).toBeLessThanOrEqual(16000);
  expect(memory.recallDiagnostics.serializedCharacters).toBeLessThanOrEqual(24000);
  for (const turn of memory.recalledTurns) {
    const original = a.state.journal.find(entry => entry.turnId === turn.turnId)!;
    expect(original.story.narrative.slice(turn.narrativeRange.start, turn.narrativeRange.end)).toBe(turn.narrativeExcerpt);
  }
});

it('window knowledge is explicit and advisory; missing usage never becomes an estimate or fake remaining value', () => {
  expect(windowRisk(999999)).toEqual({ known: false, message: unknownWindowWarning });
  expect(windowRisk(100, 1000, 200)).toMatchObject({ known: true, estimatedRemaining: 700 });
  expect(windowRisk(100, 50, 20)).toMatchObject({ known: true, estimatedRemaining: -70 });
  expect(windowRisk(100, 1000)).not.toHaveProperty('estimatedRemaining', 900);
  const messages = [{ role: 'user' as const, content: '合成文本' }];
  expect(contextStatistics(messages).actual.inputTokens).toBeUndefined();
  expect(contextStatistics(messages, { inputTokens: 123, outputTokens: 0 }).actual).toEqual({ inputTokens: 123, outputTokens: 0, totalTokens: undefined });
});

it('malformed and nonstandard historical containers remain measurable; dotted IDs and owner-scoped memory IDs are unambiguous', () => {
  const malformed = [{ role: 'user' as const, content: '<GAME_CONTEXT>\n{"broken":[' }];
  const report = inspectBudget(malformed);
  expect(report.reconciliation.characters).toBe(0); expect(report.reconciliation.bytes).toBe(0); expect(report.parseWarnings).toHaveLength(1);
  const memory = { id: 'shared-local-id', text: '不同人的记忆', sourceTurnIds: [] };
  const container = { SAVE_STATE: { npc: { 'a.b': { id: 'a.b', name: '甲', onScene: false, memories: [memory] },
    c: { id: 'c', name: '乙', onScene: false, memories: [{ ...memory, text: '另一个人的经历' }] } } }, MEMORY_CONTEXT: { recalledTurns: {} } };
  const result = inspectBudget([{ role: 'user', content: contextMessage(container) }]);
  expect(result.counts.npc).toBe(2); expect(result.counts.npcMemories).toBe(2);
  expect(result.duplicates.filter(row => row.identity.startsWith('memory:'))).toHaveLength(0);
  expect(result.reconciliation.characters).toBe(0); expect(result.recall!.strong).toBe(0);
});

it('reproducible synthetic scale comparison uses all three final composer messages and remains read-only', async () => {
  const rows = [];
  for (const count of [10, 100, 300, 1000]) {
    const a = contextScaleFixture(count); const before = JSON.stringify(a);
    for (const stage of ['story', 'variables', 'world'] as const) {
      const start = performance.now();
      const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: a.draft.userInput });
      const composeMs = performance.now() - start; const measureStart = performance.now();
      const report = inspectBudget(prompt.messages); const stats = contextStatistics(prompt.messages);
      const share = (id: string) => Number(((report.categories.find(row => row.id === id)?.proportion ?? 0) * 100).toFixed(2));
      rows.push({ synthetic: true, count, stage, characters: stats.characters, bytes: stats.contentBytes, estimatedTokens: stats.estimatedTokens,
        worldPercent: share('world'), npcMemoryPercent: share('npcMemory'), recallPercent: share('recall'), duplicateGroups: report.duplicates.length,
        repeatedRepresentationCharacters: report.repeatedRepresentation.characters, repeatedRepresentationBytes: report.repeatedRepresentation.bytes,
        composeMs: Number(composeMs.toFixed(2)), measurementMs: Number((performance.now() - measureStart).toFixed(2)) });
      expect(report.reconciliation.characters).toBe(0); expect(report.counts.npc).toBe(count);
      expect(report.repeatedRepresentation.characters).toBeLessThanOrEqual(stats.characters);
      expect(stats.characters).toBe(report.categories.reduce((s, r) => s + r.characters, 0));
    }
    expect(JSON.stringify(a)).toBe(before);
  }
  if (process.env.CONTEXT_BUDGET_METRICS === '1') await writeFile(new URL('../../CONTEXT-BUDGET-V1-METRICS.json', import.meta.url), `${JSON.stringify(rows, null, 2)}\n`);
}, 120000);
