import { expect, it } from 'vitest';
import { talentDefinitions } from '../domain/protagonist/talents';
import { talentPromptInput, talentMemoryInput, talentNarrative, emptyTalentWorld } from './fixtures/talentPrompt';
import { talentStory } from './fixtures/talentAi';
import { variableTextEnvelope } from './fixtures/variableReply';
import { captureTalentPrompt, captureTalentWire } from './fixtures/talentWire';
import baseline from './fixtures/talent-main-baseline.json';

it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('最新 main 无天赋 %s 完整 Runtime 出站正文逐字节兼容，三阶段各一次请求', async protocol => {
  for (const stage of ['story', 'variables', 'world'] as const) for (const mode of ['opening', 'regular'] as const) {
    const input = talentPromptInput(stage, mode), before = structuredClone(input);
    const answer = stage === 'story' ? talentStory(talentNarrative) : stage === 'world' ? JSON.stringify(emptyTalentWorld)
      : variableTextEnvelope(`<命令>set worldClock = ${JSON.stringify(new Date(Date.parse(input.state.worldClock) + 60000).toISOString())}\nset protagonist.emotionText = "审慎"</命令>`);
    const requests = await captureTalentWire(input, protocol, answer);
    const expected = baseline.wires.find(row => row.protocol === protocol && row.stage === stage && row.mode === mode)!;
    expect(requests).toEqual([expected.request]); expect(input).toEqual(before);
    expect(input.state.protagonist).not.toHaveProperty('talentId');
  }
});

it.each(baseline.prompts.filter(row => row.stage !== 'memory'))('最新 main 无天赋 $stage/$mode 完整消息、上下文与模块顺序一致', async row => {
  const input = talentPromptInput(row.stage as 'story' | 'variables' | 'world', row.mode as 'opening' | 'regular');
  expect(await captureTalentPrompt(input)).toEqual({ messages: row.messages, context: row.context, modules: row.modules });
});

it.each(baseline.prompts.filter(row => row.stage === 'memory'))('最新 main $task 在八天赋与无天赋时均不增加 Memory 政策', async row => {
  for (const id of [undefined, ...talentDefinitions.map(t => t.id)]) {
    expect(await captureTalentPrompt(talentMemoryInput(row.task, id))).toEqual({ messages: row.messages, context: row.context, modules: row.modules });
  }
});
