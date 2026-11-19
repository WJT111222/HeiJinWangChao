import { z } from 'zod';

const entry = z.looseObject({
  identifier: z.string().min(1),
  role: z.enum(['system', 'user', 'assistant']).default('system'),
  content: z.string().default(''),
  enabled: z.boolean().optional(),
  marker: z.boolean().default(false),
  injection_position: z.union([z.literal(0), z.literal(1)]).default(0),
  injection_depth: z.number().int().nonnegative().default(4),
  injection_order: z.number().int().default(100),
});
const orderItem = z.looseObject({ identifier: z.string().min(1), enabled: z.boolean().optional() });
const resource = z.looseObject({
  prompts: z.array(entry),
  prompt_order: z.array(z.looseObject({ character_id: z.number(), order: z.array(orderItem) })),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  extensions: z
    .looseObject({
      regex_scripts: z
        .array(
          z.looseObject({
            findRegex: z.string(),
            replaceString: z.string(),
            placement: z.array(z.number()),
            disabled: z.boolean().optional(),
            promptOnly: z.boolean().optional(),
            markdownOnly: z.boolean().optional(),
            minDepth: z.number().nullable().optional(),
            maxDepth: z.number().nullable().optional(),
            trimStrings: z.array(z.string()).optional(),
            substituteRegex: z.number().optional(),
          }),
        )
        .optional(),
      tavern_helper: z
        .looseObject({ scripts: z.array(z.record(z.string(), z.unknown())).optional() })
        .optional(),
    })
    .optional(),
});
export type PromptEntry = z.infer<typeof entry>;
export type PresetData = z.infer<typeof resource>;
export type Sampling = Pick<PresetData, 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty'>;
export interface PresetDefinition {
  id: string;
  version: string;
  lockedOff: readonly string[];
}
export const packageOverride = z.strictObject({
  version: z.string(),
  assistant: z.strictObject({ function_calling: z.boolean().optional(), squash_system_messages: z.boolean().optional() }).optional(),
  variables: z.record(z.string(), z.json()).optional(),
  scriptVariables: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  entries: z.record(
    z.string(),
    z.strictObject({ enabled: z.boolean().optional(), content: z.string().optional() }),
  ),
  scripts: z.record(
    z.string(),
    z.strictObject({
      enabled: z.boolean().optional(),
      data: z.record(z.string(), z.json()).optional(),
    }),
  ),
  sampling: resource
    .pick({ temperature: true, top_p: true, presence_penalty: true, frequency_penalty: true })
    .strict()
    .optional(),
});
export type PackageOverride = z.infer<typeof packageOverride>;

/** Keep the original script/folder tree. Only enabled and data are player preferences. */
function applyScriptPreferences(nodes: Record<string, unknown>[], edits: PackageOverride['scripts']) {
  const remaining = new Set(Object.keys(edits));
  function visit(items: Record<string, unknown>[]) {
    for (const item of items) {
      if (item.type === 'folder' && Array.isArray(item.scripts)) visit(item.scripts);
      if (typeof item.id !== 'string' || !Object.hasOwn(edits, item.id)) continue;
      if (!remaining.delete(item.id)) throw new Error('脚本标识重复');
      const edit = edits[item.id];
      if (edit.enabled !== undefined) item.enabled = edit.enabled;
      if (edit.data) item.data = { ...z.record(z.string(), z.json()).parse(item.data ?? {}), ...edit.data };
    }
  }
  visit(nodes);
  if (remaining.size) throw new Error('脚本覆盖标识不存在');
}

export function loadPreset(raw: string, definition: PresetDefinition, overrides?: PackageOverride) {
  const data = resource.parse(JSON.parse(raw));
  const tables = data.prompt_order.filter((table) => table.character_id === 100001);
  if (tables.length !== 1) throw new Error('预设需要唯一的 100001 顺序表');
  const byId = new Map(data.prompts.map((item) => [item.identifier, item]));
  if (byId.size !== data.prompts.length) throw new Error('预设条目标识重复');
  const order = tables[0].order;
  if (new Set(order.map((row) => row.identifier)).size !== order.length) throw new Error('预设顺序标识重复');
  if (overrides && overrides.version !== definition.version) throw new Error('预设覆盖版本不匹配');
  for (const id of Object.keys(overrides?.entries ?? {})) {
    if (!byId.has(id) || definition.lockedOff.includes(id)) throw new Error('覆盖包含未知或已停用条目');
  }
  const entries = order.map((row) => {
    const original = byId.get(row.identifier);
    if (!original) throw new Error('预设顺序引用缺失条目：' + row.identifier);
    const edit = overrides?.entries[row.identifier];
    return {
      ...original,
      content: edit?.content ?? original.content,
      enabled: !definition.lockedOff.includes(row.identifier) && (edit?.enabled ?? row.enabled ?? false),
    };
  });
  const scripts = structuredClone(data.extensions?.tavern_helper?.scripts ?? []);
  applyScriptPreferences(scripts, overrides?.scripts ?? {});
  const sampling: Sampling = {
    temperature: data.temperature,
    top_p: data.top_p,
    presence_penalty: data.presence_penalty,
    frequency_penalty: data.frequency_penalty,
    ...overrides?.sampling,
  };
  return { definition, raw, data, scripts, entries, sampling };
}
export type LoadedPreset = ReturnType<typeof loadPreset>;

/** 保留输入 JSON 的未识别字段与缺省形状。原件导出直接取 raw。 */
export function exportWithOverrides(raw: string, definition: PresetDefinition, overrides?: PackageOverride) {
  const view = loadPreset(raw, definition, overrides);
  const output = JSON.parse(raw) as PresetData;
  Object.assign(output, overrides?.sampling);
  const ordered = new Map(view.entries.map((p) => [p.identifier, p]));
  for (const p of output.prompts) {
    const edit = overrides?.entries[p.identifier];
    if (edit) Object.assign(p, edit);
    if (definition.lockedOff.includes(p.identifier)) p.enabled = false;
  }
  for (const row of output.prompt_order.find((t) => t.character_id === 100001)!.order)
    row.enabled = ordered.get(row.identifier)!.enabled;
  if (output.extensions?.tavern_helper?.scripts) output.extensions.tavern_helper.scripts = view.scripts;
  return JSON.stringify(output);
}
