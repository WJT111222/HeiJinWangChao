import { z } from 'zod';
import { SummarySettingsSchema, defaultSummarySettings } from '../../domain/memories/configuration';
export const settingsKey = 'heijin.settings.v1';
export const SettingsSchema = z.strictObject({
  version: z.literal(1),
  prompts: z.strictObject({
    perspective: z.enum(['first', 'second', 'third']),
    style: z.literal('general'),
    minNarrativeChars: z.number().int().positive().max(100000),
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
    streamVariables: z.boolean().default(false),
    streamWorld: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(1).max(3600),
  }),
  // 外观：夜间（原黑金）、日间（档案纸）、跟随系统。旧设置缺字段时为夜间，原样保持现有观感。
  display: z.strictObject({ appearance: z.enum(['night', 'day', 'system']) }).default({ appearance: 'night' }),
});
export type Appearance = Settings['display']['appearance'];
export type Settings = z.infer<typeof SettingsSchema>;
export function defaultSettings(): Settings {
  return {
    version: 1,
    prompts: {
      perspective: 'third',
      style: 'general',
      minNarrativeChars: 1500,
      noControl: true,
      naturalProse: true,
      actionOptions: true,
      realWorld: true,
    },
    memory: { immediateWindowSize: 10, automaticMaintenance: true, summaries: defaultSummarySettings() },
    runtime: { useVariableStage: true, useWorldStage: true, streamVariables: false, streamWorld: false, timeoutSeconds: 120 },
    display: { appearance: 'night' },
  };
}
