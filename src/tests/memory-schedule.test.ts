import { describe, it, expect } from 'vitest';
import { memoryScheduleKey } from '../ui/game/useMemoryMaintenance';
import { defaultSettings, SettingsSchema } from '../ui/settings/model';
import { STORY_STYLE_IDS } from '../ui/settings/storyStyles';
import { summaryKinds } from '../domain/memories/configuration';

describe('自动记忆维护只根据调度配置内容变化唤醒', () => {
  it('Schema 解析、JSON 恢复及新对象引用保持同一语义', () => {
    const settings = defaultSettings(), parsed = SettingsSchema.parse(settings);
    expect(parsed).not.toBe(settings); expect(parsed.memory).not.toBe(settings.memory);
    expect(parsed.memory.summaries).not.toBe(settings.memory.summaries);
    expect(memoryScheduleKey(parsed)).toBe(memoryScheduleKey(settings));
    expect(memoryScheduleKey(SettingsSchema.parse(JSON.parse(JSON.stringify(settings))))).toBe(memoryScheduleKey(settings));
  });
  it.each(STORY_STYLE_IDS)('只选择 %s 不改变调度语义', style => {
    const before = defaultSettings(), next = structuredClone(before); next.prompts.style = style;
    expect(memoryScheduleKey(next)).toBe(memoryScheduleKey(before));
  });
  it('篇幅、人称、写作开关、外观及超时不是调度条件', () => {
    const before = defaultSettings(), next = structuredClone(before);
    next.prompts = { ...next.prompts, minNarrativeChars: 4000, maxNarrativeChars: 5000, perspective: 'first', noControl: false, naturalProse: false, actionOptions: false, realWorld: false };
    next.display.appearance = 'day'; next.runtime.timeoutSeconds = 300; next.runtime.streamStory = false;
    next.runtime.useVariableStage = false; next.runtime.useWorldStage = false;
    expect(memoryScheduleKey(next)).toBe(memoryScheduleKey(before));
  });
  it('即时记忆窗口和总结提示词不会增加自动唤醒，最新值仍保留在设置中', () => {
    const before = defaultSettings(), next = structuredClone(before);
    next.memory.immediateWindowSize = 20; next.memory.automaticMaintenance = false;
    for (const kind of summaryKinds) next.memory.summaries[kind].prompt = '下次合法维护使用这份新提示词。';
    expect(memoryScheduleKey(next)).toBe(memoryScheduleKey(before));
    expect(next.memory.summaries.short.prompt).not.toBe(before.memory.summaries.short.prompt);
  });
  it.each(summaryKinds)('%s 的自动开关、阈值和每批数量每一项变化均可被识别', kind => {
    const before = defaultSettings(), key = memoryScheduleKey(before);
    for (const field of ['automatic', 'threshold', 'batchSize'] as const) {
      const next = structuredClone(before);
      if (field === 'automatic') next.memory.summaries[kind].automatic = false;
      else next.memory.summaries[kind][field]++;
      expect(SettingsSchema.safeParse(next).success).toBe(true);
      expect(memoryScheduleKey(next), `${kind}.${field}`).not.toBe(key);
    }
  });
  it('对象键排列不影响调度语义', () => {
    const before = defaultSettings(), next = structuredClone(before);
    const { short, medium, npc } = next.memory.summaries;
    next.memory.summaries = { npc, medium, short };
    next.memory.summaries.short = { prompt: short.prompt, batchSize: short.batchSize, threshold: short.threshold, automatic: short.automatic };
    expect(memoryScheduleKey(next)).toBe(memoryScheduleKey(before));
  });
});
