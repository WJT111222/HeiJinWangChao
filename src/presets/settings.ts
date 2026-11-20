import { z } from 'zod';
import { packageOverride } from './package';

const key = 'heijin.story-presets.v1';
const schema = z.strictObject({
  enabled: z.boolean(),
  selected: z.string().nullable(),
  globalVariables: z.record(z.string(), z.json()).optional(),
  packages: z.record(z.string(), packageOverride),
});
export type PresetSettings = z.infer<typeof schema>;
const defaults = (): PresetSettings => ({ enabled: false, selected: null, packages: {} });
export function readPresetSettings(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): PresetSettings {
  const raw = storage?.getItem(key);
  return raw == null ? defaults() : schema.parse(JSON.parse(raw));
}
export function savePresetSettings(
  settings: PresetSettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
) {
  const checked = schema.parse(settings);
  if (checked.enabled && !checked.selected) throw new Error('尚未选择内置预设');
  storage.setItem(key, JSON.stringify(checked));
}
export function resetPresetSelection(storage: Storage = globalThis.localStorage) {
  savePresetSettings({ ...readPresetSettings(storage), enabled: false, selected: null }, storage);
}
export function resetPackage(id: string, storage: Storage = globalThis.localStorage) {
  const settings = readPresetSettings(storage);
  delete settings.packages[id];
  savePresetSettings(settings, storage);
}
