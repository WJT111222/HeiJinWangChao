import { peintureWritingVariables } from './peintureSettings';
import { scriptOrder } from './scriptOrder';
import { sameWritingSource, type StoryWriting } from '../domain/storyWriting';
import { canonicalJson, sha256Hex } from '../domain/worldbook/canonical';
import { narrativeRange, type Settings } from '../ui/settings/model';
import controls from './resources/peinture-controls.json';
import peinture from './resources/peinture-manifest.json';
import { loadPreset, type PresetDefinition, type PackageOverride } from './package';
import { nativeDeliveryId, readPresetSettings, storyMode } from './settings';

interface PresetRegistration {
  definition: typeof peinture;
  read: () => Promise<string>;
  // Return null for UI-only scripts. Other presets can consume their full settings by default.
  scriptInputs?: (id: string, variables: Record<string, unknown>) => unknown;
  readsPresetVariables?: boolean;
}
const registry = new Map<string, PresetRegistration>([
  [
    peinture.id,
    {
      definition: peinture, scriptInputs: peintureWritingVariables, readsPresetVariables: false,
      read: async () => (await import('./resources/peinture-1118.json?raw')).default,
    },
  ],
]);
export const builtInPresets = [...registry.values()].map((item) => item.definition);
export type PresetSelection = { definition: PresetDefinition; overrides?: PackageOverride } | null;

/** Capture preferences before awaiting either repository reads or a lazy package load. */
export function captureStoryPreset(): PresetSelection {
  return literaryPreset(captureAssistantSelection());
}
export type AssistantSelection = PresetSelection | typeof nativeDeliveryId;
export function literaryPreset(selection: AssistantSelection | undefined): PresetSelection {
  return selection === nativeDeliveryId ? null : selection ?? null;
}

// Only for proving an exact match for a checkpoint written by the first PR implementation.
export function legacyWritingDigest(preset: NonNullable<PresetSelection>): Promise<string> {
  const edits = preset.overrides;
  return sha256Hex(canonicalJson({ entries: edits?.entries ?? {}, scripts: edits?.scripts ?? {},
    variables: edits?.variables ?? {}, scriptVariables: edits?.scriptVariables ?? {} }));
}

/** A v1 digest proves an exact edit record. The shipped defaults give us one more verifiable witness. */
export async function canResumeWriting(previous: StoryWriting, current: StoryWriting, selected: AssistantSelection | undefined): Promise<boolean> {
  if (previous.source !== 'preset' || previous.configurationVersion !== undefined)
    return sameWritingSource(previous, current);
  const preset = literaryPreset(selected);
  if (!preset || current.source !== 'preset' || previous.id !== current.id || previous.version !== current.version) return false;
  if (sameWritingSource(previous, current, await legacyWritingDigest(preset))) return true;
  const defaults = { definition: preset.definition };
  if (!sameWritingSource(previous, current, await legacyWritingDigest(defaults))) return false;
  return current.configuration === await effectiveConfiguration(defaults);
}

/** Hash the ordered effective prompt and script inputs. UI state and transport settings are independent. */
async function effectiveConfiguration(preset: NonNullable<PresetSelection>) {
  const loaded = await resolveStoryPreset(preset);
  const entries = loaded.entries.filter(entry => entry.enabled).map(entry => ({
    id: entry.identifier, role: entry.role, marker: entry.marker, text: entry.content,
    position: entry.injection_position, ...(entry.injection_position === 1 && { depth: entry.injection_depth, order: entry.injection_order }),
  }));
  const registration = registry.get(preset.definition.id)!;
  const scripts = scriptOrder(loaded.scripts).filter(script => script.enabled).flatMap(script => {
    const data = preset.overrides?.scriptVariables?.[script.id] ?? script.data;
    const variables = registration.scriptInputs ? registration.scriptInputs(script.id, data) : data;
    return variables === null ? [] : [{ id: script.id, module: script.module, content: script.content, variables }];
  });
  return sha256Hex(canonicalJson({ entries, scripts,
    variables: registration.readsPresetVariables === false ? undefined : preset.overrides?.variables ?? {} }));
}

export async function captureStoryWriting(selection: AssistantSelection | undefined, prompts: Settings['prompts']): Promise<StoryWriting> {
  const preset = literaryPreset(selection);
  if (preset) {
    const configuration = await effectiveConfiguration(preset);
    return { source: 'preset', id: preset.definition.id, version: preset.definition.version, configurationVersion: 2, configuration };
  }
  return { source: 'native', ...narrativeRange(prompts), perspective: prompts.perspective,
    style: prompts.style, naturalProse: prompts.naturalProse };
}

export function captureAssistantSelection(): AssistantSelection {
  if (new URLSearchParams(globalThis.location?.search).get('safe') === '1') return null;
  const settings = readPresetSettings();
  const mode = storyMode(settings);
  if (!mode) return null;
  if (mode === nativeDeliveryId) return nativeDeliveryId;
  const item = registry.get(mode);
  if (!item) throw new Error('所选内置预设不存在');
  return { definition: item.definition, overrides: settings.packages[item.definition.id] };
}
export async function resolveStoryPreset(selected: NonNullable<PresetSelection>) {
  const item = registry.get(selected.definition.id);
  if (!item) throw new Error('所选内置预设不存在');
  return loadPreset(await item.read(), item.definition, selected.overrides);
}

// Only the audited module text is shared. The standalone host has no literary entries,
// companion console, sampling overrides, status buttons or access to the literary preset's preferences.
export async function loadNativeDeliveryScript() {
  const raw = await registry.get(peinture.id)!.read();
  const scripts = (JSON.parse(raw).extensions.tavern_helper.scripts as Record<string, unknown>[])
    .filter(script => script.id === controls.mainScript);
  if (scripts.length !== 1) throw new Error('内置正文脚本缺失或重复');
  const script = { ...scripts[0], enabled: true, data: {}, button: { enabled: false, buttons: [] } };
  const definition = { ...peinture, id: nativeDeliveryId, version: '1', title: '防截断破甲模式', lockedOff: [] };
  return loadPreset(JSON.stringify({
    prompts: [], prompt_order: [{ character_id: 100001, order: [] }],
    function_calling: true, squash_system_messages: false, extensions: { tavern_helper: { scripts: [script] } },
  }), definition);
}
