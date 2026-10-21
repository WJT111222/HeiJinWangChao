import { z } from 'zod';
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
    automaticMaintenance: z.boolean().default(false) }),
  runtime: z.strictObject({
    useVariableStage: z.boolean(),
    useWorldStage: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(3600),
  }),
});
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
    memory: { immediateWindowSize: 10, automaticMaintenance: false },
    runtime: { useVariableStage: true, useWorldStage: true, timeoutSeconds: 120 },
  };
}
