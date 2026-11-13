import { useSyncExternalStore } from 'react';
import type { ReadableSaveSummary } from '../../services/storage/saveManagement';

/**
 * 备份状态只记在本机 localStorage，从不写进存档：记录每份存档最近一次导出（或从备份导入）时的正式版本与回合数。
 * revision 每次结算、撤回都只增不减，用来判断「备份之后存档是否变过」；回合数用来说清楚又玩了几回合
 * （撤回会让回合数回退，这时只说「有变动」，不报一个错的数字）。
 */
export const backupStatusKey = 'heijin.backup.status.v1';
/** 从未备份且已玩到这个回合数，存档馆顶部才提示，不弹窗。 */
export const backupReminderTurns = 5;

type Stored = Record<string, { revision: number; turnNumber: number; at: string }>;
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage: StorageAccess = () => localStorage;
export type BackupTone = 'ok' | 'warn' | 'none';
export interface BackupStatus { tone: BackupTone; text: string }

const listeners = new Set<() => void>();
let version = 0;
function changed() { version++; for (const listener of listeners) listener(); }

function read(storage: StorageAccess): Stored {
  try {
    const raw: unknown = JSON.parse(storage().getItem(backupStatusKey) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Stored = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const item = value as { revision?: unknown; turnNumber?: unknown; at?: unknown } | null;
      const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
      if (item && count(item.revision) && count(item.turnNumber)
        && typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at)))
        result[id] = { revision: item.revision, turnNumber: item.turnNumber, at: item.at };
    }
    return result;
  } catch { return {}; }
}
function write(storage: StorageAccess, update: (stored: Stored) => void) {
  try { const stored = read(storage); update(stored); storage().setItem(backupStatusKey, JSON.stringify(stored)); }
  catch { /* 状态只是提示，存储不可用时不影响备份文件本身 */ }
  changed();
}

/** 导出或导入成功后记录：这些存档在这个正式版本上已有备份文件。at 为备份文件的生成时间。 */
type Version = Pick<ReadableSaveSummary, 'saveId' | 'revision' | 'turnNumber'>;
export function recordBackup(saves: ReadonlyArray<Version>, at = new Date(), storage = browserStorage) {
  write(storage, stored => {
    for (const save of saves) stored[save.saveId] = { revision: save.revision, turnNumber: save.turnNumber, at: at.toISOString() };
  });
}
export function forgetBackup(saveId: string, storage = browserStorage) {
  write(storage, stored => { delete stored[saveId]; });
}

function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function dayLabel(at: Date, now: Date) {
  if (sameDay(at, now)) return '今天';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return '昨天';
  return `${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}`;
}

export function backupStatus(save: Version, now = new Date(), storage = browserStorage): BackupStatus {
  const record = read(storage)[save.saveId];
  if (!record) return { tone: 'none', text: '从未备份' };
  if (record.revision === save.revision) return { tone: 'ok', text: `已备份 · ${dayLabel(new Date(record.at), now)}` };
  if (save.revision > record.revision && save.turnNumber > record.turnNumber)
    return { tone: 'warn', text: `备份后又玩了 ${save.turnNumber - record.turnNumber} 回合` };
  return { tone: 'warn', text: '备份后存档有变动' };
}

/** 需要提醒的存档数：从未备份、且已玩到 backupReminderTurns 回合以上。 */
export function backupReminderCount(saves: ReadonlyArray<Version>, storage = browserStorage) {
  const stored = read(storage);
  return saves.filter(save => !stored[save.saveId] && save.turnNumber >= backupReminderTurns).length;
}

/** 让卡片与车票在导出、导入、其他标签修改后刷新备份状态。 */
export function useBackupStatusVersion() {
  return useSyncExternalStore(listener => {
    listeners.add(listener);
    const storage = (event: StorageEvent) => { if (event.key === backupStatusKey) changed(); };
    window.addEventListener('storage', storage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
  }, () => version, () => 0);
}
