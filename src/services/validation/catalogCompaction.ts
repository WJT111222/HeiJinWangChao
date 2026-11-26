/**
 * 世界/变量命令目录（COMMAND_CATALOG）的给模型展示形态。
 *
 * zod 的 toJSONSchema 会在每个使用处把同一结构完整内联一遍（例如游戏时间在目录里出现 45 次），
 * 这里只做两件纯展示层的事：
 * 1. 把重复出现的结构抽到 schema.definitions，只写一次，使用处改为 {"$ref":"#/definitions/名称"}；
 *    用 resolveCatalogRefs 展开后与内联写法逐字段一致（见 catalog-compaction 测试）。
 * 2. 游戏时间/日历日期不再把内部校验正则发给模型，改为写法说明。
 *
 * 程序校验模型输出时直接使用 zod Schema，从不读取这里的文字目录，所以不改变任何校验结果。
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const GAME_TIME_NOTE = 'ISO 8601 游戏时间，必须带时区偏移，例如 2026-10-18T09:00:00+08:00；不使用设备日期。';
const DATE_NOTE = 'YYYY-MM-DD 格式的日历日期，例如 2026-10-18。';
const MIN_SAVING = 20;

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function mapJson(value: Json, visit: (node: JsonObject) => Json | undefined): Json {
  if (Array.isArray(value)) return value.map((item) => mapJson(item, visit));
  if (!isObject(value)) return value;
  const replaced = visit(value);
  if (replaced !== undefined) return replaced;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapJson(item, visit)]));
}

/** 只替换时间/日期的内部正则为写法说明；其余字段原样保留。 */
export function describeTimeFormats<T>(schema: T): T {
  return mapJson(schema as Json, (node) => {
    if (node.type !== 'string' || typeof node.pattern !== 'string') return undefined;
    if (node.format !== 'date-time' && node.format !== 'date') return undefined;
    const { pattern: _pattern, ...rest } = node;
    void _pattern;
    const note = node.format === 'date-time' ? GAME_TIME_NOTE : DATE_NOTE;
    return { ...rest, description: typeof rest.description === 'string' ? `${rest.description} ${note}` : note };
  }) as T;
}

// A string enum or constant already imposes its value type under JSON Schema draft 7.
export function compactWorldCommandSchema<T>(schema: T): T {
  return mapJson(schema as Json, node => {
    if (node.type !== 'string') return undefined;
    if (typeof node.const !== 'string' && !(Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every(value => typeof value === 'string')))
      return undefined;
    const { type: _type, ...constraints } = node;
    void _type;
    return constraints;
  }) as T;
}

const STRUCTURAL_KEYS = new Set(['properties', 'items', 'anyOf', 'oneOf', 'allOf', 'definitions', 'additionalProperties', 'if', 'then', 'else']);

function suggestName(node: JsonObject, path: string[], defs: Map<string, string>): string {
  if (node.type === 'string' && node.format === 'date-time') return '游戏时间';
  if (node.type === 'string' && node.format === 'date') return '日历日期';
  if (node.type === 'string' && typeof node.pattern === 'string' && node.pattern.startsWith('^[a-zA-Z0-9]')) return '稳定ID';
  if (node.type === 'string' && node.pattern === undefined && node.format === undefined && typeof node.maxLength === 'number')
    return `文本上限${node.maxLength}`;
  if (node.type === 'array' && isObject(node.items)) {
    const ref = node.items.$ref;
    if (typeof ref === 'string' && defs.get(ref) === '稳定ID') return 'ID列表';
    if (node.items.type === 'string' && node.items.maxLength === undefined) return '文本列表';
  }
  if (node.type === 'integer' && node.minimum === 0 && node.maximum === Number.MAX_SAFE_INTEGER) return '非负整数';
  if (isObject(node.properties)) {
    const keys = Object.keys(node.properties);
    if (keys.length === 2 && keys.includes('kind') && keys.includes('id')) return '实体引用';
    const precision = node.properties.precision;
    if (isObject(precision) && typeof precision.const === 'string') return `纪事时间_${precision.const}`;
  }
  if (Array.isArray(node.anyOf) && JSON.stringify(node.anyOf).includes('"precision"'))
    return JSON.stringify(node.anyOf).includes('"range"') ? '纪事时间' : '纪事时间端点';
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const key = path[index];
    if (!STRUCTURAL_KEYS.has(key) && !/^\d+$/.test(key)) return key;
  }
  return '公共结构';
}

interface Candidate { count: number; length: number; firstPath: string[] }

function collect(roots: Array<[string[], Json]>): Map<string, Candidate> {
  const counts = new Map<string, Candidate>();
  const scan = (value: Json, path: string[], top: boolean) => {
    if (Array.isArray(value)) { value.forEach((item, index) => scan(item, [...path, String(index)], false)); return; }
    if (!isObject(value)) return;
    if (!top && typeof value.$ref !== 'string') {
      const key = JSON.stringify(value), found = counts.get(key);
      if (found) found.count += 1; else counts.set(key, { count: 1, length: key.length, firstPath: path });
    }
    for (const [key, item] of Object.entries(value)) scan(item, [...path, key], false);
  };
  for (const [path, root] of roots) scan(root, path, true);
  return counts;
}

/**
 * 把重复结构抽到 definitions。每轮选择节省最多的结构，直到再抽不出明显收益；
 * 只是等价改写，展开后与原内联 JSON 完全相同。
 */
export function factorRepeatedSchemas<T>(schema: { $schema?: string; oneOf: T[] }): { $schema?: string; definitions: Record<string, T>; oneOf: T[] } {
  let options = structuredClone(schema.oneOf) as Json[];
  const definitions = new Map<string, JsonObject>();
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (let round = 0; round < 200; round += 1) {
    const roots: Array<[string[], Json]> = [
      ...options.map((option, index): [string[], Json] => [['oneOf', String(index)], option]),
      ...[...definitions.entries()].map(([ref, def]): [string[], Json] => [['definitions', names.get(ref) ?? ref], def]),
    ];
    let best: [string, Candidate, number] | undefined;
    for (const [key, candidate] of collect(roots)) {
      if (candidate.count < 2) continue;
      const name = suggestName(JSON.parse(key), candidate.firstPath, names);
      const refChars = JSON.stringify({ $ref: '#/definitions/' + name }).length;
      const definitionChars = JSON.stringify(name).length + 2 + candidate.length;
      const saving = candidate.count * (candidate.length - refChars) - definitionChars;
      if (saving > MIN_SAVING && (!best || saving > best[2])) best = [key, candidate, saving];
    }
    if (!best) break;
    const [target, candidate] = best;
    const node = JSON.parse(target) as JsonObject;
    let name = suggestName(node, candidate.firstPath, names);
    for (let suffix = 2; used.has(name); suffix += 1) name = `${suggestName(node, candidate.firstPath, names)}${suffix}`;
    used.add(name);
    const ref = `#/definitions/${name}`;
    names.set(ref, name);
    const replace = (value: Json): Json => mapJson(value, (current) =>
      typeof current.$ref !== 'string' && JSON.stringify(current) === target ? { $ref: ref } : undefined);
    options = options.map((option) => isObject(option)
      ? Object.fromEntries(Object.entries(option).map(([key, item]) => [key, replace(item)])) : option);
    for (const [existing, def] of definitions)
      definitions.set(existing, Object.fromEntries(Object.entries(def).map(([key, item]) => [key, replace(item)])));
    definitions.set(ref, Object.fromEntries(Object.entries(node).map(([key, item]) => [key, replace(item)])));
  }
  const ordered = Object.fromEntries([...definitions.entries()].map(([ref, def]) => [names.get(ref) ?? ref, def]));
  return { ...(schema.$schema ? { $schema: schema.$schema } : {}), definitions: ordered as Record<string, T>, oneOf: options as T[] };
}

/** 把 {"$ref":"#/definitions/名称"} 展开回内联写法；用于测试与需要逐字段检查目录的代码。 */
export function resolveCatalogRefs<T>(schema: T): T {
  const root = schema as Json;
  if (!isObject(root) || !isObject(root.definitions)) return structuredClone(schema);
  const definitions = root.definitions;
  const expand = (value: Json, seen: Set<string>): Json => mapJson(value, (node) => {
    if (typeof node.$ref !== 'string') return undefined;
    const name = node.$ref.replace('#/definitions/', '');
    if (seen.has(name) || !(name in definitions)) throw new Error(`无法展开目录引用：${node.$ref}`);
    return expand(definitions[name], new Set([...seen, name]));
  });
  const { definitions: _definitions, ...rest } = root;
  void _definitions;
  return expand(rest, new Set()) as T;
}
