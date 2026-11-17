import { describe, expect, it } from 'vitest';
import { composePrompt } from '../prompts/composer';
import { formatTailMessage } from '../prompts/formatTail';
import { continuationInstruction } from '../domain/storyContinuation';
import { createTurnDraft } from '../domain/drafts';
import {
  NARRATIVE_LENGTH_TIERS, SettingsSchema, defaultMaxNarrativeChars, defaultSettings, narrativeLengthTier, narrativeRange,
} from '../ui/settings/model';
import { game } from './fixtures/game';

/** 正文篇幅：低 / 中 / 高 / 自定义；最低字数硬性检查，建议上限只进提示词。 */
describe('篇幅档位与区间', () => {
  it('三档数值与新玩家默认低档', () => {
    expect(NARRATIVE_LENGTH_TIERS.map(({ id, min, max }) => [id, min, max])).toEqual([['low', 1000, 2000], ['mid', 4000, 5000], ['high', 8000, 10000]]);
    const prompts = defaultSettings().prompts;
    expect(narrativeRange(prompts)).toEqual({ min: 1000, max: 2000 });
    expect(narrativeLengthTier(prompts)).toBe('low');
  });
  it('数字不等于任何一档即为自定义', () => {
    expect(narrativeLengthTier({ minNarrativeChars: 4000, maxNarrativeChars: 5000 })).toBe('mid');
    expect(narrativeLengthTier({ minNarrativeChars: 4000, maxNarrativeChars: 6000 })).toBe('custom');
    expect(narrativeLengthTier({ minNarrativeChars: 1500 })).toBe('custom');
  });
  it('老设置没有上限：按最低字数推出（1.25 倍取整到百位，不少于 2000，不超过 100000）', () => {
    expect(defaultMaxNarrativeChars(1500)).toBe(2000);
    expect(defaultMaxNarrativeChars(3000)).toBe(3800);
    expect(defaultMaxNarrativeChars(99999)).toBe(100000);
    expect(narrativeRange({ minNarrativeChars: 1500 })).toEqual({ min: 1500, max: 2000 });
  });
  it('上限低于最低字数时按最低字数处理，已存设置不会失效', () => {
    expect(narrativeRange({ minNarrativeChars: 3000, maxNarrativeChars: 2000 })).toEqual({ min: 3000, max: 3000 });
    const old = { ...defaultSettings(), prompts: { ...defaultSettings().prompts, minNarrativeChars: 1500 } };
    delete (old.prompts as { maxNarrativeChars?: number }).maxNarrativeChars;
    expect(SettingsSchema.safeParse(old).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...old, prompts: { ...old.prompts, maxNarrativeChars: 100001 } }).success).toBe(false);
  });
});

describe('篇幅区间写进提示词', () => {
  it('正文篇幅模块与格式提醒带上目标区间；最低字数仍是硬性要求', async () => {
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 4000; settings.prompts.maxNarrativeChars = 5000;
    const state = game();
    const result = await composePrompt({ stage: 'story', mode: 'regular', state, settings, userInput: '去码头', draft: createTurnDraft(state.saveId, state.revision, 'turn-length', 'regular', '去码头') });
    const text = result.messages.map((m) => m.content).join('\n');
    expect(text).toContain('目标篇幅为 4000～5000 个按程序口径计算的字符');
    expect(text).toContain('4000 是硬性最低值');
    expect(text).toContain('5000 是建议上限');
    expect(result.messages.at(-1)!.content).toContain('<正文>纯文本不少于 4000 字（目标约 4000～5000 字，写到自然收束点即可）');
  });
  it('老设置没有上限：提示词使用推出的上限，不残留占位符', async () => {
    const settings = defaultSettings();
    settings.prompts.minNarrativeChars = 1500; delete settings.prompts.maxNarrativeChars;
    const state = game();
    const result = await composePrompt({ stage: 'story', mode: 'regular', state, settings, userInput: '去码头', draft: createTurnDraft(state.saveId, state.revision, 'turn-length', 'regular', '去码头') });
    expect(result.messages.map((m) => m.content).join('\n')).toContain('目标篇幅为 1500～2000');
  });
  it('格式提醒在上限等于最低字数时不写区间', () => {
    expect(formatTailMessage('story', { actionOptions: false, minNarrativeChars: 3000, maxNarrativeChars: 3000 })).not.toContain('目标约');
  });
  it('续写指令：正文未写完时附上建议上限，已闭合时不提', () => {
    const open = continuationInstruction({ actionOptions: false, minNarrativeChars: 1000, maxNarrativeChars: 2000, partial: '<正文>雨夜' });
    expect(open).toContain('建议上限约 2000 字');
    const closed = continuationInstruction({ actionOptions: false, minNarrativeChars: 2, maxNarrativeChars: 2000, partial: '<正文>雨夜</正文>' });
    expect(closed).not.toContain('建议上限');
  });
});
