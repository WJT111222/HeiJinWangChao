import controls from './resources/peinture-controls.json';
import type { LoadedPreset, PackageOverride } from './package';
import { packageOverride } from './package';

export { controls };
export const outputKey = 'wave-out-channel-v1';
export const samplingFields = [
  { key: 'temperature', label: '温度', min: 0, max: 2 },
  { key: 'top_p', label: 'Top P', min: 0, max: 1 },
  { key: 'frequency_penalty', label: '频率惩罚', min: -2, max: 2 },
  { key: 'presence_penalty', label: '存在惩罚', min: -2, max: 2 },
] as const;
const editable = new Set(controls.sections.flatMap((section) => section.ids));
export function emptyOverride(preset: LoadedPreset): PackageOverride {
  return { version: preset.definition.version, entries: {}, scripts: {} };
}
export function enabled(preset: LoadedPreset, edits: PackageOverride, id: string) {
  return edits.entries[id]?.enabled ?? preset.entries.find((row) => row.identifier === id)?.enabled ?? false;
}
export function toggleEntry(preset: LoadedPreset, edits: PackageOverride, id: string, on: boolean) {
  if (!editable.has(id)) throw new Error('此条目由王朝管理。');
  const next = structuredClone(edits);
  const group = controls.groups.find((g) => g.ids.includes(id));
  for (const key of on && group ? group.ids : [id]) {
    const value = key === id && on;
    if (enabled(preset, next, key) !== value) next.entries[key] = { ...next.entries[key], enabled: value };
  }
  return next;
}
export function checkSelection(preset: LoadedPreset, edits: PackageOverride) {
  if (edits.version !== preset.definition.version) throw new Error('预设覆盖版本不匹配，请先恢复默认。');
  packageOverride.parse(edits);
  for (const group of controls.groups) {
    if (group.ids.filter((id) => enabled(preset, edits, id)).length > 1)
      throw new Error('请重新选择「' + group.name + '」，同组最多启用一项。');
  }
}
export function outputPreferences(edits: PackageOverride) {
  return effectiveOutput(edits.scriptVariables?.[controls.mainScript]?.[outputKey]);
}

// Matches the built-in script's waveOutPrepare. The companion console only edits preferences.
export function peintureWritingVariables(id: string, variables: Record<string, unknown>) {
  return id === controls.mainScript ? effectiveOutput(variables[outputKey]) : null;
}
function effectiveOutput(raw: unknown) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { mode: typeof value.mode === 'string' && ['auto','native','text','off'].includes(value.mode) ? value.mode : 'auto', unescape: value.unescape === true };
}
export function editOutput(edits: PackageOverride, prefs: ReturnType<typeof outputPreferences>) {
  const next = structuredClone(edits);
  ((next.scriptVariables ??= {})[controls.mainScript] ??= {})[outputKey] = prefs;
  return next;
}

// Edit only the player's insertion point. Keep the authored macros, checks and boundaries around it.
const slotStarts: Record<string, string> = {
  'wave-style-custom': '{{setvar::wave_cfg_style::',
  'wave-prose-private-ban': '补充避词与禁用句式：\n',
  'wave-custom-seam': '【要求】\n',
  'wave-custom-intimacy': '【要求】\n',
};
export function customSlot(id: string, original: string, current: string) {
  const marker = slotStarts[id];
  const at = marker ? original.lastIndexOf(marker) : -1;
  if (at < 0) return;
  const prefix = original.slice(0, at + marker.length),
    suffix = original.slice(prefix.length);
  if (
    !current.startsWith(prefix) ||
    !current.endsWith(suffix) ||
    current.length < prefix.length + suffix.length
  )
    return;
  const value = current.slice(prefix.length, current.length - suffix.length).replace(/\\([{}:\\])/gu, '$1');
  return { value, replace: (text: string) => prefix + text.replace(/[{}:\\]/gu, '\\$&') + suffix };
}
