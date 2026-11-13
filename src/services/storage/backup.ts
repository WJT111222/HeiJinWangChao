import { z } from 'zod';
import { DataError } from '../../domain/common';
import { TurnDraftSchema } from '../../domain/drafts';
import type { TurnDraft } from '../../domain/drafts';
import type { GameState } from '../../domain/state';
import { migrateSave } from './migrations';

/**
 * 玩家存档备份文件（.heijin.json）。
 * 只含游戏进度与未结算草稿；不含 AI 密钥、渠道、设置、提示词排序、撤回快照与提交回执。
 */
export const backupFormat = 'heijin-backup';
export const backupVersion = 1;

export interface BackupEntry {
  summary: { title: string; turnNumber: number; revision: number; schemaVersion: number; updatedAt: string };
  state: GameState;
  draft?: TurnDraft;
}
export interface BackupFile {
  format: typeof backupFormat;
  version: typeof backupVersion;
  app: string;
  exportedAt: string;
  saves: BackupEntry[];
  /** `sha256:<hex>`。导出环境没有 WebCrypto 时省略，导入方会标为「无法验证」。 */
  checksum?: string;
}

/**
 * 完整性校验结果。只有真正算出并比对过才算 valid；缺少校验和或无法计算都是 unverified。
 * mismatch 只提示警告，不阻止读取各份通过逐份校验的存档。
 */
export type BackupChecksumStatus = 'valid' | 'mismatch' | 'unverified';

/** 已读入并逐份校验后的备份条目；单份存档损坏不影响同文件的其他存档。 */
export type ParsedBackupEntry =
  | { ok: true; title: string; state: GameState; draft?: TurnDraft; draftDropped?: string }
  | { ok: false; title: string; error: string; code: string };
export interface ParsedBackup {
  app: string;
  exportedAt: string;
  checksum: BackupChecksumStatus;
  entries: ParsedBackupEntry[];
}

const EnvelopeSchema = z.object({
  format: z.literal(backupFormat),
  version: z.number().int(),
  app: z.string().max(40).catch('未知版本'),
  exportedAt: z.string().max(40).catch(''),
  saves: z.array(z.object({
    summary: z.object({ title: z.string() }).passthrough().optional(),
    state: z.unknown(),
    draft: z.unknown().optional(),
  })).min(1).max(200),
  checksum: z.string().max(100).optional(),
});

/** 文件体积上限（UTF-8 字节）：远高于真实存档，只用来拒绝明显不是备份的巨型文件。 */
export const maxBackupBytes = 256 * 1024 * 1024;
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const tooLarge = () => new DataError('BACKUP_TOO_LARGE', '文件太大，不是黑金王朝的备份文件。');

/** 按 UTF-8 计算字节数，超过 limit 立即停止；不为大文件再分配一份编码缓冲。 */
export function utf8ByteLength(text: string, limit = Number.POSITIVE_INFINITY): number {
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= limit; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) { bytes += 4; index++; }
    else bytes += 3; // 其余 BMP 字符；孤立代理项按 TextEncoder 写成 U+FFFD，同为 3 字节。
  }
  return bytes;
}

async function sha256(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 草稿只有指向同一存档、且基于同一正式版本时才随备份恢复；否则跳过草稿，不影响存档。 */
export function compatibleDraft(state: GameState, raw: unknown): { draft?: TurnDraft; dropped?: string } {
  if (raw === undefined || raw === null) return {};
  const parsed = TurnDraftSchema.safeParse(raw);
  if (!parsed.success) return { dropped: '草稿结构无法通过校验，已跳过草稿。' };
  if (parsed.data.saveId !== state.saveId) return { dropped: '草稿不属于这份存档，已跳过草稿。' };
  if (parsed.data.baseSaveRevision !== state.revision) return { dropped: '草稿基于旧的回合，已过期，已跳过草稿。' };
  return { draft: parsed.data };
}

export async function serializeBackup(entries: readonly BackupEntry[], app: string, now = new Date()): Promise<string> {
  const saves = entries.map((entry) => ({ summary: entry.summary, state: entry.state, ...(entry.draft ? { draft: entry.draft } : {}) }));
  const checksum = await sha256(JSON.stringify(saves));
  const file: BackupFile = {
    format: backupFormat, version: backupVersion, app, exportedAt: now.toISOString(),
    saves, ...(checksum ? { checksum } : {}),
  };
  return JSON.stringify(file);
}

export function backupSummary(state: GameState): BackupEntry['summary'] {
  return { title: state.title, turnNumber: state.turnNumber, revision: state.revision, schemaVersion: state.schemaVersion, updatedAt: state.updatedAt };
}

/** 安全的文件名：去掉系统不允许的字符。 */
export function backupFileName(entries: readonly BackupEntry[], now = new Date()): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const clean = (text: string) => text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '').slice(0, 40) || '存档';
  if (entries.length === 1) {
    const [entry] = entries;
    return `黑金王朝备份_${clean(entry.summary.title)}_第${entry.summary.turnNumber}回_${date}.heijin.json`;
  }
  return `黑金王朝备份_全部${entries.length}份存档_${date}.heijin.json`;
}

/** 读取并校验备份文本。整体格式不对时抛 DataError；单份存档的问题记录在条目里。 */
export async function parseBackup(text: string, maxBytes = maxBackupBytes): Promise<ParsedBackup> {
  // UTF-16 码元数不会超过 UTF-8 字节数，先用 length 快速拒绝，再按真实字节计算。
  if (text.length > maxBytes || utf8ByteLength(text, maxBytes) > maxBytes) throw tooLarge();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new DataError('BACKUP_INVALID', '这不是黑金王朝的备份文件。请选择导出时得到的 .heijin.json 文件。'); }
  const format = z.object({ format: z.string(), version: z.number() }).safeParse(raw);
  if (format.success && format.data.format === 'heijin-raw-save')
    throw new DataError('BACKUP_RAW', '这是「导出原始数据」得到的恢复文件，不能直接导入。它用于排查无法读取的存档。');
  if (format.success && format.data.format === backupFormat && format.data.version > backupVersion)
    throw new DataError('BACKUP_FUTURE', '这份备份来自更新的游戏版本，请先更新游戏再导入；本机存档没有任何改动。');
  const envelope = EnvelopeSchema.safeParse(raw);
  if (!envelope.success || envelope.data.version !== backupVersion)
    throw new DataError('BACKUP_INVALID', '这不是黑金王朝的备份文件。请选择导出时得到的 .heijin.json 文件。');
  const { saves, checksum } = envelope.data;
  let checksumStatus: BackupChecksumStatus = 'unverified';
  if (checksum && !checksumPattern.test(checksum)) checksumStatus = 'mismatch';
  else if (checksum) {
    const actual = await sha256(JSON.stringify((raw as { saves: unknown }).saves));
    if (actual) checksumStatus = actual === checksum ? 'valid' : 'mismatch';
  }
  const entries: ParsedBackupEntry[] = saves.map((save) => {
    const title = typeof save.summary?.title === 'string' ? save.summary.title.slice(0, 80) : '未命名存档';
    try {
      const state = migrateSave(save.state);
      const { draft, dropped } = compatibleDraft(state, save.draft);
      return { ok: true, title: state.title, state, ...(draft ? { draft } : {}), ...(dropped ? { draftDropped: dropped } : {}) };
    } catch (error) {
      const code = error instanceof DataError ? error.code : 'CORRUPT_SAVE';
      const message = code === 'FUTURE_VERSION'
        ? '这份存档来自更新的游戏版本，请先更新游戏再导入。'
        : code === 'UNSUPPORTED_VERSION' ? '这份存档版本太旧，当前程序无法读取。' : '这份存档的内容已损坏，无法导入。';
      return { ok: false, title, error: message, code };
    }
  });
  return { app: envelope.data.app, exportedAt: envelope.data.exportedAt, checksum: checksumStatus, entries };
}

/** 从文件读取：先按 File/Blob 的真实字节数拒绝超限文件，再读成文本。 */
export async function readBackupFile(file: Blob): Promise<ParsedBackup> {
  if (file.size > maxBackupBytes) throw tooLarge();
  return parseBackup(await file.text());
}
