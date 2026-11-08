import { expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { contextStatistics } from '../prompts/statistics';
import { selectVariableDomains } from '../prompts/variableDomains';
import { selectWorldDomains } from '../prompts/worldDomains';
import { contextV2Fixture } from './fixtures/contextV2';

// 同一文件/夹具可复制到基线worktree执行；测量真实composePrompt最终messages，非手写上下文。
it('合成富状态最终messages体积可重复测量（估算token，不代表供应商计费）', async () => {
  const a = contextV2Fixture(), before = structuredClone(a), rows = [];
  for (const stage of ['story', 'variables', 'world'] as const) {
    const domains = stage === 'variables' ? selectVariableDomains(a.state, a.draft).domains
      : stage === 'world' ? selectWorldDomains(a.state, a.draft).domains : undefined;
    const prompt = await composePrompt({ ...a, stage, mode: 'regular', userInput: a.draft.userInput, domains });
    const statistics = contextStatistics(prompt.messages);
    rows.push({ stage, messages: prompt.messages.length, characters: statistics.characters,
      estimatedTokens: statistics.estimatedTokens, method: statistics.method,
      serializedMessagesBytes: new TextEncoder().encode(JSON.stringify(prompt.messages)).length });
    expect(statistics.characters).toBeGreaterThan(0);
  }
  expect(a).toEqual(before);
  if (process.env.CONTEXT_METRICS === '1') console.info(JSON.stringify(rows, null, 2));
});
