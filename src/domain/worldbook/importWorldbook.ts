import { importCharacterBook } from './importCharacterBook';
import { importNative } from './importNative';
import { importSillyTavern } from './importSillyTavern';
import { notice } from './notices';
import type { ImportOptions } from './release';
import { WORLDBOOK_FORMAT, WORLDBOOK_LIMITS, isPlainObject, type ImportNotice, type WorldbookImportResult } from './schema';

/**
 * 世界书导入入口：只做解析与转换，不联网、不入库、不执行文件里的任何内容。
 * 结果要么是一个本地版本（origin 一律为 local），要么是逐条可定位的中文错误。
 */
export type DetectedFormat = 'heijin' | 'sillytavern' | 'character-card-v2';

export function detectWorldbookFormat(root: Record<string, unknown>): { format: DetectedFormat } | { error: ImportNotice } {
  if (root.format === WORLDBOOK_FORMAT) return { format: 'heijin' };
  if (root.spec === 'chara_card_v3') return { error: notice('unsupported_format', {}, { value: '角色卡 V3' }) };
  if (isPlainObject(root.data) && root.data.character_book !== undefined) return { format: 'character-card-v2' };
  if (root.lorebookVersion !== undefined) return { error: notice('unsupported_format', {}, { value: 'NovelAI 世界书' }) };
  if (root.kind === 'memory') return { error: notice('unsupported_format', {}, { value: 'Agnai 记忆书' }) };
  if (root.type === 'risu') return { error: notice('unsupported_format', {}, { value: 'RisuAI 世界书' }) };
  if (Array.isArray(root.entries)) {
    // 数组形式：角色卡世界书用 keys / insertion_order / enabled，酒馆用 key / order / disable。
    const first = root.entries.find(isPlainObject);
    if (first && first.key === undefined && (Array.isArray(first.keys) || first.insertion_order !== undefined || first.enabled !== undefined))
      return { format: 'character-card-v2' };
    return { format: 'sillytavern' };
  }
  if (root.entries !== undefined) return { format: 'sillytavern' };
  return { error: notice('unknown_format') };
}

/** 非递归地计算 JSON 值的最大嵌套层数；超过 limit 后立即停止。 */
export function jsonDepthExceeds(value: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (item === null || typeof item !== 'object') continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(item) ? item : Object.values(item)) stack.push([child, depth + 1]);
  }
  return false;
}

export function importWorldbookValue(value: unknown, options: ImportOptions = {}): Promise<WorldbookImportResult> {
  if (!isPlainObject(value)) return Promise.resolve({ ok: false, notices: [notice('invalid_root')] });
  if (jsonDepthExceeds(value, WORLDBOOK_LIMITS.maxDepth))
    return Promise.resolve({ ok: false, notices: [notice('too_deep', {}, { limit: WORLDBOOK_LIMITS.maxDepth })] });
  const detected = detectWorldbookFormat(value);
  if ('error' in detected) return Promise.resolve({ ok: false, notices: [detected.error] });
  switch (detected.format) {
    case 'heijin': return importNative(value);
    case 'character-card-v2': return importCharacterBook(value, options);
    case 'sillytavern': return importSillyTavern(value, options);
  }
}

/** UTF-8 字节数，超过 limit 后立即停止计数。 */
export function utf8Bytes(text: string, limit = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (let i = 0; i < text.length && bytes <= limit; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}
function megabytes(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export async function importWorldbookText(text: string, options: ImportOptions = {}): Promise<WorldbookImportResult> {
  const bytes = utf8Bytes(text, WORLDBOOK_LIMITS.maxBytes);
  if (bytes > WORLDBOOK_LIMITS.maxBytes)
    return { ok: false, notices: [notice('too_large', {}, { value: `超过 ${megabytes(WORLDBOOK_LIMITS.maxBytes)}`, limit: megabytes(WORLDBOOK_LIMITS.maxBytes) })] };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.startsWith('\u0089PNG') || body.startsWith('�PNG'))
    return { ok: false, notices: [notice('unsupported_format', {}, { value: 'PNG 图片内嵌的世界书' })] };
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    const detail = error instanceof RangeError ? '嵌套层级过深' : '';
    return { ok: false, notices: [notice('invalid_json', {}, { value: detail })] };
  }
  return importWorldbookValue(value, options);
}
