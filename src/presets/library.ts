import peinture from './resources/peinture-manifest.json';
import { loadPreset, type PresetDefinition, type PackageOverride } from './package';
import { readPresetSettings } from './settings';

const registry = new Map([
  [
    peinture.id,
    {
      definition: peinture,
      read: async () => (await import('./resources/peinture-1118.json?raw')).default,
    },
  ],
]);
export const builtInPresets = [...registry.values()].map((item) => item.definition);
export type PresetSelection = { definition: PresetDefinition; overrides?: PackageOverride } | null;

/** Capture preferences before awaiting either repository reads or a lazy package load. */
export function captureStoryPreset(): PresetSelection {
  const settings = readPresetSettings();
  if (!settings.enabled) return null;
  const item = settings.selected && registry.get(settings.selected);
  if (!item) throw new Error('所选内置预设不存在');
  return { definition: item.definition, overrides: settings.packages[item.definition.id] };
}
export async function resolveStoryPreset(selected: NonNullable<PresetSelection>) {
  const item = registry.get(selected.definition.id);
  if (!item) throw new Error('所选内置预设不存在');
  return loadPreset(await item.read(), item.definition, selected.overrides);
}
