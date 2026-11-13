import { useRef, useState } from 'react';
import { DataError } from '../../domain/common';
import { serializeRawSave } from '../../services/storage/saveManagement';
import type { SaveRepository } from '../../services/storage/saveRepository';

// Shared by the existing desktop card and phone ticket. The original storage key
// and serializer remain authoritative; exporting never repairs or writes data.
export function useRawSaveExport(repository: SaveRepository | undefined, storageKey: IDBValidKey) {
  const [exporting,setExporting] = useState(false), [notice,setNotice] = useState('');
  const exportLock = useRef(false);
  async function exportRaw() {
    if (!repository || exportLock.current) return;
    exportLock.current = true; setExporting(true); setNotice('');
    try {
      const text = serializeRawSave(await repository.exportRaw(storageKey));
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      try {
        link.href = url; link.download = 'heijin-raw-save.json'; document.body.append(link); link.click();
      } finally {
        link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice('已发起原始数据下载，请检查浏览器下载记录。数据库未修改。');
    } catch (error) {
      setNotice(error instanceof DataError && error.code === 'RAW_EXPORT_FORMAT'
        ? error.message : '导出失败，未生成文件，原始数据未修改。请检查浏览器存储权限后重试。');
    } finally { exportLock.current = false; setExporting(false); }
  }
  return {exporting,notice,exportRaw};
}
