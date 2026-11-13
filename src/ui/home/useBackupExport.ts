import { useRef, useState } from 'react';
import { PRODUCT_VERSION } from '../../app/product';
import { backupFileName, serializeBackup } from '../../services/storage/backup';
import type { SaveRepository } from '../../services/storage/saveRepository';
import { recordBackup } from './backupStatus';

export interface BackupExportResult { text: string; file: File }

/** 浏览器下载；不写数据库，不联网。 */
function download(file: File) {
  const url = URL.createObjectURL(file), link = document.createElement('a');
  try { link.href = url; link.download = file.name; document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** 系统分享面板（手机上可发到微信、网盘等）。不支持文件分享时返回 false。 */
export function canShareFile(file: File) {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); }
  catch { return false; }
}
export async function shareFile(file: File) {
  try { await navigator.share({ files: [file], title: file.name }); return true; }
  catch { return false; } // 用户取消或系统拒绝：文件已下载，不算失败
}

/**
 * 导出一份或多份可读取的存档为 .heijin.json。只读数据库；成功后在本机记下备份状态。
 * 文件只含正式存档与未结算草稿，不含 AI 密钥、渠道、设置、撤回快照与提交回执。
 */
export function useBackupExport(repository: SaveRepository | undefined) {
  const [exporting, setExporting] = useState(false);
  const lock = useRef(false);
  async function exportSaves(saveIds: readonly string[]): Promise<BackupExportResult> {
    if (!repository || lock.current || !saveIds.length) throw new Error('导出暂不可用');
    lock.current = true; setExporting(true);
    try {
      const entries = await repository.exportBackup(saveIds);
      const now = new Date();
      const name = backupFileName(entries, now);
      const file = new File([await serializeBackup(entries, PRODUCT_VERSION, now)], name, { type: 'application/json' });
      download(file);
      recordBackup(entries.map(entry => ({ saveId: entry.state.saveId, revision: entry.state.revision, turnNumber: entry.state.turnNumber })), now);
      const text = entries.length === 1
        ? `已导出「${entries[0].summary.title}」第 ${entries[0].summary.turnNumber} 回合的备份：${name}`
        : `已导出 ${entries.length} 份存档的备份：${name}`;
      return { text, file };
    } finally { lock.current = false; setExporting(false); }
  }
  return { exporting, exportSaves };
}
