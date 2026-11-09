import { z } from 'zod';
import { memoryContentPrompts } from './defaultPrompts';
export const summaryKinds = ['short', 'medium', 'npc'] as const;
export type SummaryKind = typeof summaryKinds[number];
export const summaryNames = { short: '短期 → 中期', medium: '中期 → 长期', npc: 'NPC 短期 → 中期' } as const;
export const maximumSummaryBatch = 100;
export const SummaryConfigSchema = z.strictObject({
  enabled: z.boolean().optional(), automatic: z.boolean(),
  threshold: z.number().int().min(1).max(10000), batchSize: z.number().int().min(1).max(maximumSummaryBatch),
  prompt: z.string().trim().min(1).max(30000),
}).refine(value => value.batchSize <= value.threshold, { path: ['batchSize'], message: '每批数量不能超过触发阈值' })
  // Legacy total switch was removed: migrate old enabled=false to automatic=false.
  .transform(({ enabled, ...config }) => ({ ...config, automatic: enabled === false ? false : config.automatic }));
export type SummaryConfig = z.infer<typeof SummaryConfigSchema>;
export function defaultSummaryConfig(kind: SummaryKind): SummaryConfig {
  return { automatic: true, threshold: kind === 'short' ? 30 : kind === 'medium' ? 50 : 20,
    batchSize: kind === 'npc' ? 15 : 10, prompt: memoryContentPrompts[kind] };
}
export const SummarySettingsSchema = z.strictObject({ short: SummaryConfigSchema, medium: SummaryConfigSchema, npc: SummaryConfigSchema });
export type SummarySettings = z.infer<typeof SummarySettingsSchema>;
export const defaultSummarySettings = (): SummarySettings => ({ short: defaultSummaryConfig('short'), medium: defaultSummaryConfig('medium'), npc: defaultSummaryConfig('npc') });
