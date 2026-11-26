import { z } from 'zod';
import type { LoadedPreset, PackageOverride } from './package';
import { applyMenuChoices, checkSelection, controlsFor, enabled } from './peintureSettings';

const schemeSchema = z.object({
  format: z.literal('wave-console-scheme'),
  version: z.literal(1),
  family: z.literal('wave-1103-dame'),
  name: z.string().trim().min(1).max(80),
  createdAt: z.string().optional(),
  prompts: z.array(z.object({
    id: z.string().min(1).max(150), enabled: z.boolean(), content: z.string().max(1000000),
  })).max(500),
}).refine(s => new Set(s.prompts.map(p => p.id)).size === s.prompts.length, '方案包含重复条目');

export type PeintureScheme = z.infer<typeof schemeSchema>;
export function parseScheme(value: unknown) {
  const parsed = schemeSchema.safeParse(value);
  if (!parsed.success) throw new Error('浪潮方案格式、名称或条目无效。');
  return parsed.data;
}

function editableIds(preset: LoadedPreset) {
  return new Set(controlsFor(preset.definition.id).sections.flatMap(s => s.ids));
}

export function snapshotScheme(preset: LoadedPreset, edits: PackageOverride, name: string) {
  const ids = editableIds(preset);
  return parseScheme({ format: 'wave-console-scheme', version: 1, family: 'wave-1103-dame', name,
    createdAt: new Date().toISOString(), prompts: preset.entries.filter(row => ids.has(row.identifier))
      .map(row => ({ id: row.identifier, enabled: enabled(preset, edits, row.identifier),
        content: edits.entries[row.identifier]?.content ?? row.content })) });
}

export function applyScheme(preset: LoadedPreset, edits: PackageOverride, scheme: PeintureScheme) {
  const ids = editableIds(preset);
  const entries = scheme.prompts.filter(p => ids.has(p.id));
  const next = applyMenuChoices(preset, edits, new Map(entries.map(row => [row.id, row.enabled])));
  for (const row of entries) next.entries[row.id] = { ...next.entries[row.id], content: row.content };
  checkSelection(preset, next);
  return { edits: next, applied: entries.length, skipped: scheme.prompts.length - entries.length };
}
