import type { WorldbookRelease } from './schema';

/**
 * 确定性 JSON：对象键按码点排序、无空白；数组保持原顺序。
 * 直接拼字符串，不重建对象，因此 "__proto__" 等特殊键也按普通键处理。
 * 只接受 JSON 能表达的值；遇到 undefined / 函数 / 非有限数字直接报错，避免两份“看起来一样”的内容得到不同哈希。
 */
export const MAX_CANONICAL_DEPTH = 128;

export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new RangeError('canonicalJson: 嵌套过深');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: 非有限数字无法序列化');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
      const keys = Object.keys(value).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue; // 与 JSON.stringify 一致：省略 undefined 字段
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item, depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: 不支持的类型 ${typeof value}`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 版本内容哈希的覆盖范围：元信息、规范化条目、原始来源。不含书 ID、版本 ID、来源标记和兼容提示。 */
export type HashedContent = Pick<WorldbookRelease, 'metadata' | 'entries' | 'source'>;

export function contentHash(content: HashedContent): Promise<string> {
  return sha256Hex(canonicalJson({ metadata: content.metadata, entries: content.entries, source: content.source }));
}
