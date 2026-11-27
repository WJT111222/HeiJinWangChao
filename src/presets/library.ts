import { definition as prototype, prototypeRequested, readPrototype } from './spreset/definition';
import { peintureWritingVariables } from './peintureSettings';
import { parsePresetTemplate } from './macros';
import { literaryEntry } from './messages';
import { scriptOrder } from './scriptOrder';
import { sameWritingSource, type StoryWriting } from '../domain/storyWriting';
import { canonicalJson, sha256Hex } from '../domain/worldbook/canonical';
import { narrativeRange, type Settings } from '../ui/settings/model';
import peinture1124 from './resources/peinture-1124-manifest.json';
import controls from './resources/peinture-controls.json';
import peinture from './resources/peinture-manifest.json';
import { loadPreset, type PresetDefinition, type PackageOverride, type LoadedPreset } from './package';
import { withdrawnPresetId } from './withdrawnPreset';
import { AiError } from '../services/ai/errors';
import { nativeDeliveryId, readPresetSettings, storyMode } from './settings';

interface PresetRegistration<T extends PresetDefinition = PresetDefinition & { title: string; author: string }> {
  definition: T;
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
  [peinture1124.id, { definition: peinture1124, scriptInputs: peintureWritingVariables, readsPresetVariables: false,
    read: async () => (await import('./resources/peinture-1124.json?raw')).default }],
]);
export const builtInPresets = [...registry.values()].map((item) => item.definition);
function registrationFor(id: string): PresetRegistration<PresetDefinition> | undefined {
  if (import.meta.env.DEV && id === prototype.id) return { definition: prototype, read: readPrototype };
  return registry.get(id);
}
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

/** Older checkpoints only store a digest. Verify the old spelling against an available witness. */
export async function canResumeWriting(previous: StoryWriting, current: StoryWriting, selected: AssistantSelection | undefined): Promise<boolean> {
  if (previous.source !== 'preset' || previous.configurationVersion === currentVersion)
    return sameWritingSource(previous, current);
  const preset = literaryPreset(selected);
  if (!preset || current.source !== 'preset' || current.configurationVersion !== currentVersion
    || previous.id !== current.id || previous.version !== current.version
    || current.id !== preset.definition.id || current.version !== preset.definition.version) return false;
  const version = previous.configurationVersion;
  const loaded = await resolveStoryPreset(preset);
  if (current.configuration !== await sha256Hex(configurationText(loaded, preset))) return false;
  const oldDigest = (pack: LoadedPreset, selection: NonNullable<PresetSelection>) => version === undefined
    ? legacyWritingDigest(selection) : sha256Hex(configurationText(pack, selection, version));
  if (previous.configuration === await oldDigest(loaded, preset)) return true;
  const defaults = { definition: preset.definition };
  const shipped = loadPreset(loaded.raw, defaults.definition);
  return previous.configuration === await oldDigest(shipped, defaults)
    && current.configuration === await sha256Hex(configurationText(shipped, defaults));
}

const currentVersion = 4;
function configurationText(loaded: LoadedPreset, preset: NonNullable<PresetSelection>, version: 2 | 3 | 4 = currentVersion) {
  const active = loaded.entries.filter(entry => entry.enabled);
  const entries = version === 2 ? active.map(entry => ({
    id: entry.identifier, role: entry.role, marker: entry.marker, text: entry.content,
    position: entry.injection_position, ...(entry.injection_position === 1 && { depth: entry.injection_depth, order: entry.injection_order }),
  })) : active.map(entry => {
    const input = literaryEntry(entry);
    if (version === 3 || input.kind !== 'text') return input;
    // Encode each static template separately to retain the macro parser's full supported depth.
    return { ...input, text: JSON.stringify(parsePresetTemplate(input.text)) };
  });
  const registration = registrationFor(preset.definition.id)!;
  const scripts = scriptOrder(loaded.scripts).filter(script => script.enabled).flatMap(script => {
    const data = preset.overrides?.scriptVariables?.[script.id] ?? script.data;
    const variables = registration.scriptInputs ? registration.scriptInputs(script.id, data) : data;
    return variables === null ? [] : [{ id: script.id, module: script.module, content: script.content, variables }];
  });
  return canonicalJson({ entries, scripts,
    variables: registration.readsPresetVariables === false ? undefined : preset.overrides?.variables ?? {} });
}

function nativeWriting(prompts: Settings['prompts']): StoryWriting {
  return { source: 'native', ...narrativeRange(prompts), perspective: prompts.perspective,
    style: prompts.style, naturalProse: prompts.naturalProse };
}

export async function captureStoryWriting(selection: AssistantSelection | undefined, prompts: Settings['prompts']): Promise<StoryWriting> {
  return (await writingWitness(selection, prompts)).writing;
}

/** Prepare immutable package bytes once. Final comparison runs synchronously in the dispatch stack. */
export async function writingWitness(selection: AssistantSelection | undefined, prompts: Settings['prompts']) {
  const selected = literaryPreset(selection);
  if (!selected) {
    const expected = nativeWriting(prompts);
    return { writing: expected, matches: (live: AssistantSelection, now: Settings['prompts']) =>
      !literaryPreset(live) && canonicalJson(nativeWriting(now)) === canonicalJson(expected) };
  }
  const loaded = await resolveStoryPreset(selected);
  const expected = configurationText(loaded, selected);
  const { id, version } = selected.definition;
  const writing: StoryWriting = { source: 'preset', id, version, configurationVersion: currentVersion, configuration: await sha256Hex(expected) };
  return { writing, matches: (live: AssistantSelection) => {
    const next = literaryPreset(live);
    return !!next && next.definition.id === id && next.definition.version === version
      && expected === configurationText(loadPreset(loaded.raw, next.definition, next.overrides), next);
  } };
}

export function captureAssistantSelection(): AssistantSelection {
  const safe = new URLSearchParams(globalThis.location?.search).get('safe') === '1';
  let settings;
  try { settings = readPresetSettings(); } catch (error) {
    if (safe) return null;
    throw error;
  }
  if (settings.enabled && settings.selected === withdrawnPresetId)
    throw new AiError('configuration', undefined, { fieldPath: 'tavern.preset_withdrawn' });
  if (safe) return null;
  const mode = storyMode(settings);
  if (!mode) return import.meta.env.DEV && prototypeRequested() ? { definition: prototype } : null;
  if (mode === nativeDeliveryId) return nativeDeliveryId;
  const item = registry.get(mode);
  if (!item) throw new Error('所选内置预设不存在');
  return { definition: item.definition, overrides: settings.packages[item.definition.id] };
}
export async function resolveStoryPreset(selected: NonNullable<PresetSelection>) {
  const item = registrationFor(selected.definition.id);
  if (!item) throw new Error('所选内置预设不存在');
  if (import.meta.env.DEV && item.definition.id === prototype.id && item.definition.version !== selected.definition.version)
    throw new Error('文学预设版本不匹配');
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
