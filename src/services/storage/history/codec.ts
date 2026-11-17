import { z } from 'zod';
import { DataError, requireData } from '../../../domain/common';
import type { GameState } from '../../../domain/state';
import { migrateSave } from '../migrations';
import { backupSummary, maxBackupBytes, serializeBackup, utf8ByteLength } from '../backup';

// A per-payload safety bound, NOT a count limit or automatic eviction policy.
export const maxHistoryBytes = 256 * 1024 * 1024;
export const PayloadSchema = z.strictObject({
  version: z.literal(1), encoding: z.enum(['gzip', 'json']),
  rawBytes: z.number().int().min(1).max(maxHistoryBytes),
  digest: z.string().regex(/^[a-f0-9]{64}$/), data: z.instanceof(ArrayBuffer),
});
export type HistoryPayload = z.infer<typeof PayloadSchema>;
export async function exportHistory(state: GameState, app: string): Promise<string> {
  const text = await serializeBackup([{ state, summary: backupSummary(state) }], app);
  requireData(text.length <= maxBackupBytes && utf8ByteLength(text, maxBackupBytes) <= maxBackupBytes,
    'HISTORY_TOO_LARGE', '此节点的备份文件超过现有导入安全上限；未导出，原收藏保留');
  return text;
}
export async function digestBytes(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function boundedStream(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      requireData(size <= limit, 'HISTORY_TOO_LARGE', '历史节点超过安全读取上限，原数据未修改');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function encodeHistory(state: GameState): Promise<HistoryPayload> {
  const checked = migrateSave(state), json = JSON.stringify(checked);
  requireData(json.length <= maxHistoryBytes, 'HISTORY_TOO_LARGE', '单份历史节点超过 256 MiB 安全上限');
  const bytes = new TextEncoder().encode(json);
  requireData(bytes.byteLength <= maxHistoryBytes, 'HISTORY_TOO_LARGE', '单份历史节点超过 256 MiB 安全上限');
  const digest = await digestBytes(bytes);
  if (typeof CompressionStream !== 'undefined') {
    // An actual compressor error is a failed save, never an implicit overwrite/fallback.
    const compressed = await boundedStream(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), maxHistoryBytes);
    if (compressed.byteLength < bytes.byteLength)
      return { version: 1, encoding: 'gzip', rawBytes: bytes.byteLength, digest, data: compressed.buffer };
  }
  return { version: 1, encoding: 'json', rawBytes: bytes.byteLength, digest, data: bytes.buffer };
}
export async function decodeHistory(raw: HistoryPayload): Promise<GameState> {
  const payload = PayloadSchema.parse(raw);
  requireData(payload.data.byteLength > 0 && payload.data.byteLength <= maxHistoryBytes, 'HISTORY_TOO_LARGE', '历史节点大小非法');
  if (payload.encoding === 'gzip' && typeof DecompressionStream === 'undefined')
    throw new DataError('HISTORY_COMPRESSION_UNAVAILABLE', '此浏览器无法解压历史节点，请使用支持 gzip 解压的新版浏览器；原节点保留');
  const bytes = payload.encoding === 'json' ? new Uint8Array(payload.data)
    : await boundedStream(new Blob([payload.data]).stream().pipeThrough(new DecompressionStream('gzip')), payload.rawBytes);
  requireData(bytes.byteLength === payload.rawBytes && await digestBytes(bytes) === payload.digest,
    'HISTORY_CORRUPT', '历史节点完整性校验失败，未修改任何存档');
  return migrateSave(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}
