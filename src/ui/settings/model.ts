import { STORY_STYLE_IDS } from './storyStyles';
import { STORY_DIFFICULTY_IDS } from './storyDifficulty';
import { z } from 'zod';
import { SummarySettingsSchema, defaultSummarySettings } from '../../domain/memories/configuration';
export const settingsKey = 'heijin.settings.v1';

/**
 * 正文篇幅档位：最低字数是程序硬性检查（不足判失败重写），上限只写进提示词作为目标，写多了照常通过。
 * 旧设置缺少建议上限时保持自定义；显式保存的两个数可用于识别预设。
 */
export const NARRATIVE_LENGTH_TIERS = [
  { id: 'low', label: '低', min: 1000, max: 2000 },
  { id: 'mid', label: '中', min: 4000, max: 5000 },
  { id: 'high', label: '高', min: 8000, max: 10000 },
] as const;
export type NarrativeLengthTier = (typeof NARRATIVE_LENGTH_TIERS)[number]['id'] | 'custom';
export const NARRATIVE_CHARS_LIMIT = 100000;
export function narrativeLengthTier(prompts: { minNarrativeChars: number; maxNarrativeChars?: number }): NarrativeLengthTier {
  if (prompts.maxNarrativeChars === undefined) return 'custom';
  const { minNarrativeChars: min, maxNarrativeChars: max } = prompts;
  return NARRATIVE_LENGTH_TIERS.find((tier) => tier.min === min && tier.max === max)?.id ?? 'custom';
}
/** 实际使用的篇幅区间：建议上限缺失时按最低字数推出，且不低于最低字数。 */
export function narrativeRange(prompts: { minNarrativeChars: number; maxNarrativeChars?: number }): { min: number; max: number } {
  const min = prompts.minNarrativeChars;
  return { min, max: Math.max(min, prompts.maxNarrativeChars ?? defaultMaxNarrativeChars(min)) };
}
/** 旧设置只有最低字数：建议上限取最低字数的 1.25 倍（取整到百位），且不少于 2000。 */
export function defaultMaxNarrativeChars(min: number): number {
  return Math.min(NARRATIVE_CHARS_LIMIT, Math.max(2000, Math.ceil((min * 1.25) / 100) * 100));
}
export const SettingsSchema = z.strictObject({
  version: z.literal(1),
  prompts: z.strictObject({
    perspective: z.enum(['first', 'second', 'third']),
    style: z.enum(STORY_STYLE_IDS),
    // 剧情难度（可选）：缺省按宽松处理，旧设置原样可读；读取一律经 storyDifficulty。
    difficulty: z.enum(STORY_DIFFICULTY_IDS).optional(),
    minNarrativeChars: z.number().int().positive().max(NARRATIVE_CHARS_LIMIT),
    // 建议上限（可选）：读取一律经 narrativeRange，旧设置缺字段时按最低字数推出，低于最低字数时按最低字数处理。
    maxNarrativeChars: z.number().int().positive().max(NARRATIVE_CHARS_LIMIT).optional(),
    noControl: z.boolean(),
    naturalProse: z.boolean(),
    actionOptions: z.boolean(),
    realWorld: z.boolean(),
  }),
  memory: z.strictObject({ immediateWindowSize: z.number().int().positive().max(10000),
    automaticMaintenance: z.boolean().optional(), summaries: SummarySettingsSchema.optional() }).transform(memory => {
      const summaries = memory.summaries ?? defaultSummarySettings();
      if (!memory.summaries && memory.automaticMaintenance === false) {
        for (const config of Object.values(summaries)) config.automatic = false;
      }
      return { ...memory, automaticMaintenance: memory.automaticMaintenance ?? true, summaries };
    }),
  runtime: z.strictObject({
    useVariableStage: z.boolean(),
    useWorldStage: z.boolean(),
    streamStory: z.boolean().default(true),
    streamVariables: z.boolean().default(false),
    streamWorld: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(1).max(3600),
    /** 关闭时只保留 500/502/503/504 的一次基础重试。开启后生成失败都会重试，最多 3 次，不含首次请求。 */
    failureAutoRetry: z.boolean().default(false),
    maxAutoRetries: z.union([z.literal(1), z.literal(3)]).default(3),
  }),
  // 外观：夜间（原黑金）、日间（档案纸）、跟随系统。旧设置缺字段时为夜间，原样保持现有观感。
  display: z.strictObject({ appearance: z.enum(['night', 'day', 'system']) }).default({ appearance: 'night' }),
  // 生成完成提示音：关闭／切到别处时（默认）／总是。旧设置缺字段时按默认，点选即保存。
  notifications: z.strictObject({ completionChime: z.enum(['off', 'background', 'always']) }).default({ completionChime: 'background' }),
});
export type Appearance = Settings['display']['appearance'];
export type Settings = z.infer<typeof SettingsSchema>;
export function defaultSettings(): Settings {
  return {
    version: 1,
    prompts: {
      perspective: 'third',
      style: 'general',
      minNarrativeChars: 1000,
      maxNarrativeChars: 2000,
      noControl: true,
      naturalProse: true,
      actionOptions: true,
      realWorld: true,
    },
    memory: { immediateWindowSize: 10, automaticMaintenance: true, summaries: defaultSummarySettings() },
    runtime: { useVariableStage: true, useWorldStage: true, streamStory: true, streamVariables: false, streamWorld: false, timeoutSeconds: 120, failureAutoRetry: false, maxAutoRetries: 3 },
    display: { appearance: 'night' },
    notifications: { completionChime: 'background' },
  };
}

/** Apply only preference fields changed relative to the options the editor opened with. */
export function mergeSettingsChanges(base: Settings, edited: Settings, latest: Settings): Settings {
  function section<T extends object>(before: T, after: T, current: T): T {
    const result = { ...current };
    for (const key of Object.keys({ ...before, ...after }) as (keyof T)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) result[key] = after[key];
    }
    return result;
  }
  return {
    ...latest,
    prompts: section(base.prompts, edited.prompts, latest.prompts),
    memory: section(base.memory, edited.memory, latest.memory),
    runtime: section(base.runtime, edited.runtime, latest.runtime),
    display: section(base.display, edited.display, latest.display),
    notifications: section(base.notifications, edited.notifications, latest.notifications),
  };
}
