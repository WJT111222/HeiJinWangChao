import { it, expect } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { array, record } from '../services/ai/protocols';
import { recallV2Fixture } from './fixtures/recallV2';
import { sentContext } from './fixtures/contextAssertions';

// This file and its fixture can run unchanged at the PR #73 main baseline.
it.each(['story', 'variables', 'world'] as const)('200回合%s最终请求体积（V1/V2共用夹具）', async stage => {
  const a = recallV2Fixture(), start = performance.now();
  const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: a.draft.userInput });
  const elapsed = performance.now() - start;
  const context = sentContext(prompt.messages), memory = record(context.MEMORY_CONTEXT);
  expect(record(context.SAVE_STATE).schemaVersion).toBe(6);
  if (process.env.RECALL_METRICS === '1') console.info('recall-volume', JSON.stringify({ stage,
    recalledIds: array(memory.recalledTurns).map(entry => record(entry).turnId),
    recallCharacters: JSON.stringify(memory.recalledTurns).replace(/[<>&]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).length,
    messages: prompt.messages.length, ...contextStatistics(prompt.messages),
    serializedMessagesBytes: new TextEncoder().encode(JSON.stringify(prompt.messages)).length, composeMs: elapsed }));
});
