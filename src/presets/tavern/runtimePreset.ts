import isEqual from 'lodash/isEqual';
import { z } from 'zod';
import { packageOverride, type LoadedPreset, type PackageOverride } from '../package';
import { readPresetSettings, savePresetSettings } from '../settings';

const samplingKeys = { temp_openai: 'temperature', top_p_openai: 'top_p', freq_pen_openai: 'frequency_penalty', pres_pen_openai: 'presence_penalty' } as const;
export function editOverrides(preset: LoadedPreset, edit: (override: PackageOverride) => void) {
  const settings = readPresetSettings();
  const key = preset.definition.id;
  const override = settings.packages[key] ??= { version: preset.definition.version, entries: {}, scripts: {} };
  if (override.version !== preset.definition.version) throw new Error('预设覆盖版本不匹配');
  edit(override);
  savePresetSettings(settings);
}
export function runtimePreset(preset: LoadedPreset, publish: () => void, report: (message: string) => void) {
  const native = structuredClone(preset.data);
  Object.assign(native, readPresetSettings().packages[preset.definition.id]?.assistant);
  const order = native.prompt_order.find(t => t.character_id === 100001)!.order;
  const originalOrder = order.map(row => row.identifier);
  for (const entry of preset.entries) {
    const p = native.prompts.find(p => p.identifier === entry.identifier)!;
    p.content = entry.content;
    p.enabled = entry.enabled;
    order.find(row => row.identifier === entry.identifier)!.enabled = entry.enabled;
  }
  for (const [live, key] of Object.entries(samplingKeys)) native[live] = preset.sampling[key];
  const name = 'title' in preset.definition ? String(preset.definition.title) : preset.definition.id;
  const baseline = structuredClone(native);
  const editable = new Set(['prompts', 'prompt_order', 'function_calling', 'squash_system_messages', ...Object.keys(samplingKeys)]);
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function changes() {
    for (const key of new Set([...Object.keys(baseline), ...Object.keys(native)])) {
      if (!editable.has(key) && !isEqual(native[key], baseline[key])) throw new Error('暂不支持保存此预设字段：' + key);
    }
    if (native.prompt_order.find(table => table.character_id === 100001)?.order !== order
      || native.prompts.length !== baseline.prompts.length) throw new Error('暂不支持替换条目集合。');
    if (order.length !== originalOrder.length || order.some((row,i) => row.identifier !== originalOrder[i])) throw new Error('暂不支持更改预设条目顺序。');
    const oldOrder = baseline.prompt_order.find(t => t.character_id === 100001)!.order;
    const entries: PackageOverride['entries'] = {};
    for (const [i, p] of native.prompts.entries()) {
      const row = order.find(r => r.identifier === p.identifier);
      const before = baseline.prompts[i];
      if (!before || before.identifier !== p.identifier) throw new Error('暂不支持替换条目标识。');
      const enabled = row?.enabled ?? p.enabled;
      for (const key of new Set([...Object.keys(p), ...Object.keys(before)])) {
        if (key !== 'content' && key !== 'enabled' && !isEqual(p[key], before[key]))
          throw new Error('暂不支持保存此条目字段：' + key);
      }
      if (p.content !== before.content || enabled !== (oldOrder.find(row => row.identifier === p.identifier)?.enabled ?? before.enabled)) {
        if (preset.definition.lockedOff.includes(p.identifier)) throw new Error('此条目在王朝版中停用。');
        entries[p.identifier] = { content: p.content, enabled };
      }
    }
    const sampling: PackageOverride['sampling'] = {};
    for (const [live, key] of Object.entries(samplingKeys)) {
      if (native[live] !== baseline[live]) sampling[key] = z.number().parse(native[live]);
    }
    const assistant: NonNullable<PackageOverride['assistant']> = {};
    for (const key of ['function_calling', 'squash_system_messages'] as const) {
      if (native[key] !== baseline[key]) assistant[key] = z.boolean().parse(native[key]);
    }
    const edits = { entries, sampling, assistant };
    packageOverride.parse({ ...edits, version: preset.definition.version, scripts: {} });
    return edits;
  }
  function applyChanges(override: PackageOverride) {
    const edits = changes();
    Object.assign(override.entries, edits.entries);
    Object.assign(override.assistant ??= {}, edits.assistant);
    Object.assign(override.sampling ??= {}, edits.sampling);
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return false;
    editOverrides(preset, applyChanges);
    Object.assign(baseline, structuredClone(native));
    pending = false;
    publish();
    return true;
  }
  function saveSettingsDebounced() {
    changes(); // report unsupported edits synchronously, before the console confirms them
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => { try { flush(); } catch (error) { report(String(error)); } }, 200);
  }
  function syncSaved(override?: PackageOverride) {
    // Keep live references held by scripts. Rebuild only the supported editing fields.
    const defaults = preset.data.prompt_order.find(t => t.character_id === 100001)!.order;
    for (const [i, item] of native.prompts.entries()) {
      const original = preset.data.prompts[i];
      const edit = override?.entries[item.identifier];
      item.content = edit?.content ?? original.content;
      const row = order.find(r => r.identifier === item.identifier);
      if (row) {
        row.enabled = !preset.definition.lockedOff.includes(item.identifier) && (edit?.enabled ?? defaults.find(r => r.identifier === item.identifier)?.enabled ?? false);
        item.enabled = row.enabled;
      }
    }
    for (const [live,key] of Object.entries(samplingKeys)) native[live] = override?.sampling?.[key] ?? preset.data[key];
    for (const key of ['function_calling','squash_system_messages'] as const) native[key] = override?.assistant?.[key] ?? preset.data[key];
    Object.assign(baseline, structuredClone(native));
    publish();
  }
  function getPreset(which = 'in_use') {
    if (which !== 'in_use' && which !== name) throw new Error('未知预设');
    const prompts = native.prompts.map(p => {
      const row = order.find(r => r.identifier === p.identifier);
      return { id: p.identifier, name: p.name, role: p.role, enabled: row?.enabled ?? p.enabled ?? true,
        ...(!p.marker ? { content: p.content } : {}),
        ...(p.system_prompt !== true || p.marker ? { position: p.injection_position === 1
          ? { type: 'in_chat', depth: p.injection_depth, order: p.injection_order } : { type: 'relative' } } : {}),
        ...(p.extra ? { extra: p.extra } : {}) };
    });
    const byId = new Map(prompts.map(p => [p.id,p]));
    const regexScripts = (native.extensions?.regex_scripts ?? []).map(rule => ({
      id: rule.id, script_name: rule.scriptName, enabled: !rule.disabled,
      find_regex: rule.findRegex, replace_string: rule.replaceString, trim_strings: rule.trimStrings ?? [],
      source: { user_input: rule.placement.includes(1), ai_output: rule.placement.includes(2),
        slash_command: rule.placement.includes(3), world_info: rule.placement.includes(5), reasoning: rule.placement.includes(6) },
      destination: { display: rule.markdownOnly, prompt: rule.promptOnly }, run_on_edit: rule.runOnEdit,
      min_depth: rule.minDepth ?? null, max_depth: rule.maxDepth ?? null,
    }));
    return structuredClone({ prompts: order.map(row => byId.get(row.identifier)!),
      prompts_unused: prompts.filter(p => !originalOrder.includes(p.id)), extensions: { ...native.extensions, regex_scripts: regexScripts },
      settings: { should_stream: native.stream_openai, max_context: native.openai_max_context,
        max_completion_tokens: native.openai_max_tokens, temperature: native.temp_openai, top_p: native.top_p_openai,
        frequency_penalty: native.freq_pen_openai, presence_penalty: native.pres_pen_openai, enable_function_calling: native.function_calling, reply_count: native.n,
        seed: native.seed, reasoning_effort: native.reasoning_effort, request_thoughts: native.show_thoughts,
        request_images: native.request_images, enable_web_search: native.enable_web_search, squash_system_messages: native.squash_system_messages,
        repetition_penalty: native.repetition_penalty, top_k: native.top_k, min_p: native.min_p, top_a: native.top_a,
        allow_sending_images: native.image_inlining ? native.inline_image_quality : 'disabled', allow_sending_videos: !!native.video_inlining,
        character_name_prefix: ({'-1':'none','0':'default','2':'content','1':'completion'} as Record<string,string>)[String(native.names_behavior)],
        wrap_user_messages_in_quotes: !!native.wrap_in_quotes } });
  }
  return { native, getPreset, getLoadedPresetName: () => name, saveSettingsDebounced, flush, applyChanges, syncSaved };
}
