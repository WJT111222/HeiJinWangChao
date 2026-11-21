import { z } from 'zod';
import { packageOverride } from './package';
import controls from './resources/peinture-controls.json';

export const presetSettingsKey = 'heijin.story-presets.v1';
// The adapter is not a selectable literary preset. Its private override also fits the original v1 strict schema.
export const nativeDeliveryId = 'heijin-native-story-delivery';
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
  const raw = storage?.getItem(presetSettingsKey);
  return raw == null ? defaults() : schema.parse(JSON.parse(raw));
}
export function savePresetSettings(
  settings: PresetSettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
) {
  const checked = schema.parse(settings);
  if (checked.enabled && !checked.selected) throw new Error('尚未选择内置预设');
  if (checked.enabled) delete checked.packages[nativeDeliveryId];
  storage.setItem(presetSettingsKey, JSON.stringify(checked));
}
export function enableNativeDelivery(settings: PresetSettings) {
  settings.packages[nativeDeliveryId] = {
    version: '1', entries: {}, scripts: { [controls.mainScript]: { enabled: true } },
  };
}
export function resetPresetSelection(storage: Storage = globalThis.localStorage) {
  const settings = readPresetSettings(storage);
  delete settings.packages[nativeDeliveryId];
  savePresetSettings({ ...settings, enabled: false, selected: null }, storage);
}
export function resetPackage(id: string, storage: Storage = globalThis.localStorage) {
  const settings = readPresetSettings(storage);
  delete settings.packages[id];
  savePresetSettings(settings, storage);
}

export function storyMode(settings: PresetSettings): string | null {
  if (settings.enabled) {
    if (!settings.selected || settings.selected === nativeDeliveryId) throw new Error('所选文学预设无效');
    return settings.selected;
  }
  return settings.packages[nativeDeliveryId]?.scripts[controls.mainScript]?.enabled === true ? nativeDeliveryId : null;
}
