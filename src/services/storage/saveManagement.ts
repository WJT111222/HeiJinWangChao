import { DataError } from '../../domain/common';
import type { GameState } from '../../domain/state';

export type ReadableSaveSummary = Pick<GameState, 'saveId' | 'title' | 'revision' | 'schemaVersion' | 'updatedAt'> & {
  status: 'readable'; storageKey: IDBValidKey;
};
export type UnreadableSaveSummary = {
  status: 'unreadable'; storageKey: IDBValidKey; title: string; saveId?: string; updatedAt?: string;
};
export type SaveSummary = ReadableSaveSummary | UnreadableSaveSummary;
export interface RawSaveRecord { key: IDBValidKey; value: unknown }
export interface RawSaveExport {
  format: 'heijin-raw-save'; version: 1;
  records: { saves: RawSaveRecord[]; drafts: RawSaveRecord[]; turnReceipts: RawSaveRecord[]; turnUndo?: RawSaveRecord[]; saveControls?: RawSaveRecord[] };
}

export function unreadableSaveSummary(storageKey: IDBValidKey, raw: unknown): UnreadableSaveSummary {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    status: 'unreadable', storageKey,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : '未命名存档',
    ...(typeof value.saveId === 'string' ? { saveId: value.saveId } : {}),
    ...(typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)) ? { updatedAt: value.updatedAt } : {}),
  };
}

// For display/React identity only. Storage operations always receive the original IDB key.
export function saveKeyText(key: IDBValidKey): string {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(key);
  if (key instanceof Date) return `Date(${key.toISOString()})`;
  if (Array.isArray(key)) return JSON.stringify(key.map(part => [typeof part, saveKeyText(part)]));
  const bytes = ArrayBuffer.isView(key) ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength) : new Uint8Array(key);
  return `Binary(${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')})`;
}

// No GameState validation, migration or defaults. Optional properties can actually be
// stored as undefined by existing draft code. Preserve their paths in export metadata
// (JSON has no undefined) instead of inserting null/defaults into the raw records.
// Refuse other non-JSON values instead of silently changing or discarding them.
export function serializeRawSave(data: RawSaveExport): string {
  const ancestors = new Set<object>();
  const undefinedFields: Array<Array<string | number>> = [];
  function check(value: unknown, path: Array<string | number> = []): void {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
    if (!value || typeof value !== 'object' || ancestors.has(value)) throw new Error('non-JSON');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('non-JSON');
    if (array && (Object.keys(value).length !== value.length || Object.keys(value).some((key, i) => key !== String(i)))) throw new Error('non-JSON');
    ancestors.add(value);
    for (const [key, part] of Object.entries(value)) {
      const next = [...path, array ? Number(key) : key];
      if (part === undefined && !array) undefinedFields.push(next);
      else check(part, next);
    }
    ancestors.delete(value);
  }
  try { check(data); return JSON.stringify({ ...data, ...(undefinedFields.length ? { undefinedFields } : {}) }, null, 2); }
  catch { throw new DataError('RAW_EXPORT_FORMAT', '原始数据包含 JSON 无法原样保存的值，导出已停止；数据库未修改。'); }
}
