import { packageOverride, type LoadedPreset, type PackageOverride } from '../package';
import { oracleDefinition } from './definition';
import menu from './menu.json';

export { menu };
export const commentEntry = '48863da8-9556-4f14-b5bf-1816e4d4207b';
export const directionId = 'catgod-direction';
export const defaults = (): PackageOverride => ({
  version: oracleDefinition.version,
  entries: {},
  scripts: {},
});
export function checkOracle(preset: LoadedPreset) {
  const active = new Set<string>();
  for (const row of menu.filter((row) => row.kind === 'radio')) {
    if (!preset.entries.find((entry) => entry.identifier === row.id)?.enabled) continue;
    if (active.has(row.group)) throw new Error('同组只能选择一项：' + row.group);
    active.add(row.group);
  }
}
export function oracleEdits(value: unknown) {
  const edits = packageOverride.parse(value);
  if (
    edits.version !== oracleDefinition.version ||
    Object.keys(edits.scripts).length ||
    edits.scriptVariables ||
    edits.assistant ||
    edits.variables
  )
    throw new Error('方案版本或设置不适用');
  for (const [id, edit] of Object.entries(edits.entries)) {
    if (id !== directionId && !menu.some((row) => row.id === id)) throw new Error('方案包含不可编辑的条目');
    if (id === directionId && edit.enabled === false) throw new Error('自定义要求不能关闭');
  }
  return edits;
}
