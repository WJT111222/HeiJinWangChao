import { describe, expect, it } from 'vitest';
import { assessSummary } from '../domain/memories/summary';
import { parseStory } from '../services/validation/aiOutputs';
import { StorySchema } from '../domain/state';
import { composePrompt } from '../prompts/composer';
import { readPromptResource } from '../prompts/loader';
import { defaultSettings } from '../ui/settings/model';
import { game } from './fixtures/game';

const settings = defaultSettings();
settings.prompts.minNarrativeChars = 1;
settings.prompts.actionOptions = false;
const output = (summary: string) => `<正文>主角在站台等待。</正文><短期记忆>${summary}</短期记忆><变量规划>[]</变量规划>`;

describe('逐回合事实摘要：100～200汉字质量目标，不机械截断或阻断', () => {
  it.each([100, 150, 200])('%s 汉字符合目标', (count) => {
    const text = '记'.repeat(count);
    expect(assessSummary(text)).toEqual({ hanCharacters: count, status: 'within_target' });
    expect(parseStory(output(text), 'regular', settings).summary).toBe(text);
  });
  it.each([95, 99, 201, 205])('轻微偏离 %s 汉字，提示质量但仍保留完整摘要', (count) => {
    const text = '记'.repeat(count);
    expect(assessSummary(text).status).toBe(count < 100 ? 'below_target' : 'above_target');
    expect(parseStory(output(text), 'regular', settings).summary).toBe(text);
  });
  it.each([2, 500])('%s 汉字的有效摘要也不自动凑字、截断或触发付费重试', (count) => {
    const text = '记'.repeat(count);
    expect(parseStory(output(text), 'opening', settings).summary).toBe(text);
  });
  it('按Unicode汉字计数；标点、空格、数字、英文不虚增汉字数，扩展汉字计一次', () => {
    expect(assessSummary('汉𠮷字，。123 ABC \n')).toEqual({ hanCharacters: 3, status: 'below_target' });
    const text = '约定周三见面，地址 ABC-123。';
    expect(parseStory(output(text), 'regular', settings).summary).toBe(text);
    expect(assessSummary('Meeting at 3pm.').status).toBe('below_target');
  });
  it.each(['', '  \n  '])('新输出缺少有效摘要时拒绝；旧Schema仍兼容空摘要读取', (text) => {
    expect(assessSummary(text).status).toBe('empty');
    expect(() => parseStory(output(text), 'regular', settings)).toThrow();
    expect(StorySchema.safeParse({ turnKind: 'regular', narrative: '旧正文', summary: text, variableGuide: [] }).success).toBe(true);
  });
  it.each(['opening', 'regular'] as const)('%s 的共享正文协议包含同次请求目标，六套主提示词保持独立', async (mode) => {
    const prompt = await composePrompt({ stage: 'story', mode, state: game(), settings, userInput: '' });
    const protocol = (await readPromptResource('shared.06_story_output')).replace('{{minNarrativeChars}}', '1');
    expect(prompt.messages).toContainEqual({ role: 'system', content: protocol });
    expect(protocol.replace(/\s/g, '')).toContain('目标约100～200汉字');
    expect(protocol).toContain('同一次正文生成请求');
    expect(protocol).toContain('不另行请求模型');
    expect(prompt.modules.filter((module) => module.id === 'shared.06_story_output')).toHaveLength(1);
    expect(prompt.modules.find((module) => module.id === 'shared.06_story_output')?.version).toBe('0.1.1-m5-p1');
    expect(prompt.modules.filter((module) => module.id.startsWith('stages.')).map((module) => module.id)).toEqual([`stages.${mode}.story`]);
  });
});
