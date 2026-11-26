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
const animeControls = {
  ...controls,
  sections: controls.sections.map(section => {
    if (section.name === '人物与关系') return { ...section, ids: [...section.ids, 'wave-core-anti-ceo'] };
    if (section.name === '篇幅与文风') return { ...section, ids: [...section.ids, 'wave-style-xianzi', 'wave-style-stream-of-consciousness'] };
    return section;
  }),
  groups: controls.groups.map(group => group.name === '文风'
    ? { ...group, ids: [...group.ids, 'wave-style-xianzi', 'wave-style-stream-of-consciousness'] } : group),
};
export const isPeinture = (id: string) => id === 'peinture-1118' || id === 'peinture-1124';
export const controlsFor = (id: string) => id === 'peinture-1124' ? animeControls : controls;
export function emptyOverride(preset: LoadedPreset): PackageOverride {
  return { version: preset.definition.version, entries: {}, scripts: {} };
}
export function enabled(preset: LoadedPreset, edits: PackageOverride, id: string) {
  return edits.entries[id]?.enabled ?? preset.entries.find((row) => row.identifier === id)?.enabled ?? false;
}
const streamStyle = 'wave-style-stream-of-consciousness';
const streamRequired = ['wave-person-first', 'wave-mind-blackbox'];
const dialogueOnly = 'wave-dialogue-only';
const streamLocked = new Set([dialogueOnly, ...animeControls.groups
  .filter(group => group.ids.some(id => streamRequired.includes(id))).flatMap(group => group.ids)]);

export function lockedByWritingStyle(preset: LoadedPreset, edits: PackageOverride, id: string) {
  return preset.definition.id === 'peinture-1124' && enabled(preset, edits, streamStyle) && streamLocked.has(id);
}
/** Resolve an entire menu edit before applying the final style's linked choices. */
export function applyMenuChoices(preset: LoadedPreset, edits: PackageOverride, choices: ReadonlyMap<string, boolean>) {
  const controls = controlsFor(preset.definition.id);
  const next = structuredClone(edits);
  function set(id: string, on: boolean) {
    if (enabled(preset, next, id) !== on) next.entries[id] = { ...next.entries[id], enabled: on };
  }
  for (const [id, on] of choices) {
    if (!controls.sections.some(s => s.ids.includes(id))) throw new Error('此条目由王朝管理。');
    set(id, on);
  }
  for (const group of controls.groups) {
    const chosen = group.ids.filter(id => choices.get(id));
    if (chosen.length > 1) throw new Error('「' + group.name + '」存在互斥选项，最多启用一项。');
    if (chosen.length) for (const id of group.ids) set(id, id === chosen[0]);
  }
  if (preset.definition.id === 'peinture-1124' && enabled(preset, next, streamStyle)) {
    for (const id of streamLocked) {
      const required = streamRequired.includes(id);
      if (choices.has(id) && choices.get(id) !== required)
        throw new Error('意识流须使用第一人称和黑箱心声，并关闭纯对白。');
      set(id, required);
    }
  }
  return next;
}
export function toggleEntry(preset: LoadedPreset, edits: PackageOverride, id: string, on: boolean) {
  if (lockedByWritingStyle(preset, edits, id)) throw new Error('请先切换意识流文风，再调整视角、心声或纯对白。');
  return applyMenuChoices(preset, edits, new Map([[id, on]]));
}
export function checkSelection(preset: LoadedPreset, edits: PackageOverride) {
  if (edits.version !== preset.definition.version) throw new Error('预设覆盖版本不匹配，请先恢复默认。');
  packageOverride.parse(edits);
  if (lockedByWritingStyle(preset, edits, dialogueOnly) &&
    (enabled(preset, edits, dialogueOnly) || streamRequired.some(id => !enabled(preset, edits, id)))) {
    throw new Error('意识流须使用第一人称和黑箱心声，并关闭纯对白。');
  }
  for (const group of controlsFor(preset.definition.id).groups) {
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
