import { afterEach, expect, it, vi } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { formatTailMessage } from '../prompts/formatTail';
import { requestFixtureStage } from './fixtures/stageRequest';
import { AiClient } from '../services/ai/client';
import { payloadMessages, requestInspections } from '../services/ai/inspection';
import { stageResponses } from '../services/ai/stageResponses';
import { wireRequest } from '../services/ai/protocols';
import { requestSnapshot } from '../services/ai/snapshot';
import { sentContext } from './fixtures/contextAssertions';
import { talentPromptInput, talentNarrative, emptyTalentWorld } from './fixtures/talentPrompt';
import { talentAi, talentJson, talentStory } from './fixtures/talentAi';
import { variableTextEnvelope } from './fixtures/variableReply';

afterEach(() => { stageResponses.clear(); requestInspections.clear(); });

it.each(['openai', 'deepseek', 'gemini', 'anthropic'] as const)('%s 实际 Runtime 出站覆盖三阶段/开局与普通：单份天赋、格式尾、原解析及一次请求', async protocol => {
  for (const stage of ['story', 'variables', 'world'] as const) for (const mode of ['opening', 'regular'] as const) {
    const input = talentPromptInput(stage, mode, 'cyber_tyrant'), before = structuredClone(input), options = talentAi(protocol);
    const text = stage === 'story' ? talentStory(talentNarrative) : stage === 'world' ? JSON.stringify(emptyTalentWorld)
      : variableTextEnvelope(`<命令>set worldClock = ${JSON.stringify(new Date(Date.parse(input.state.worldClock) + 60_000).toISOString())}\nset protagonist.emotionText = "审慎"</命令>`);
    const fetcher = vi.fn<typeof fetch>(async () => talentJson(protocol, text));
    const result = await requestFixtureStage(input, options.config, options.vault, { stream: false }, new AiClient(fetcher));
    expect(fetcher).toHaveBeenCalledTimes(1); expect(input).toEqual(before);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]!.body)), messages = payloadMessages(body, protocol), context = sentContext(messages);
    expect(context.PROTAGONIST_TALENT).toMatchObject({ stage, definition: { id: 'cyber_tyrant', mechanismName: '数字统御' } });
    expect(messages.at(-1)?.content).toBe(formatTailMessage(stage, input.settings.prompts));
    expect(messages.filter(m => m.content.includes('【最终格式提醒】'))).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('synthetic-talent-key'); expect(JSON.stringify(body)).not.toContain('cache_control');
    if (stage === 'story') expect(result.result).toHaveProperty('narrative', talentNarrative);
    if (stage === 'variables') expect(result.result).toHaveProperty('commands', expect.arrayContaining([expect.objectContaining({ type: 'UpdateProtagonist', changes: { emotionText: '审慎' } })]));
    if (stage === 'world') expect(result.result).toEqual(emptyTalentWorld);
  }
});

it('官方 Claude 缓存分块包含固定天赋；拼接消息不丢内容，中转结构不改变', async () => {
  const options = talentAi('anthropic'), input = talentPromptInput('story', 'regular', 'public_sovereign'), prompt = await composePrompt(input);
  for (const official of [true, false]) {
    options.config.channels[0].baseUrl = official ? 'https://api.anthropic.com' : 'http://127.0.0.1:1';
    const snapshot = requestSnapshot(options.config, 'story', options.vault);
    const body = JSON.parse(String(wireRequest(snapshot, prompt.messages, false).init.body));
    expect(sentContext(payloadMessages(body, 'anthropic'))).toEqual(sentContext(prompt.messages));
    expect(JSON.stringify(body).includes('cache_control')).toBe(official);
  }
});
