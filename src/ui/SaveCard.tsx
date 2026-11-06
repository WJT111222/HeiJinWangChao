import { useRef, useState } from 'react';
import type { SaveRepository } from '../services/storage/saveRepository';
import { saveKeyText, serializeRawSave } from '../services/storage/saveManagement';
import type { SaveSummary } from '../services/storage/saveManagement';
import { DataError } from '../domain/common';
import { dateTime } from './panels/playerView';

export function SaveCard({ save, index, selected, repository, onOpen, onSelect, onDelete }: {
  save: SaveSummary; index: number; selected: boolean; repository?: SaveRepository;
  onOpen: (id: string) => void; onSelect: (id: string) => void; onDelete: () => void;
}) {
  const [exporting, setExporting] = useState(false), [notice, setNotice] = useState('');
  const exportLock = useRef(false);
  async function exportRaw() {
    if (!repository || exportLock.current) return;
    exportLock.current = true; setExporting(true); setNotice('');
    try {
      const text = serializeRawSave(await repository.exportRaw(save.storageKey));
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
  return <article className={`save-card ${selected ? 'selected' : ''}`}>
    <div className="save-card-top">
      <span className="eyebrow">ARCHIVE {String(index + 1).padStart(2, '0')}</span>
      <span className="tag">{save.status === 'unreadable' ? '无法读取' : selected ? '已选择' : '本地存档'}</span>
    </div>
    <h3>{save.title}</h3>
    <p className="muted">{save.updatedAt ? `保存于 ${dateTime(save.updatedAt)}` : '保存时间无法读取'}</p>
    {save.status === 'unreadable' && <>
      <p className="save-record-key">存档记录 ID：{saveKeyText(save.storageKey)}</p>
      {save.saveId && save.saveId !== save.storageKey && <p className="save-record-key">内容中的存档 ID：{save.saveId}</p>}
      <p>当前版本无法读取这条记录。其他存档不受影响；可先导出原始数据，再决定是否删除。</p>
    </>}
    <div className="save-card-actions">
      {save.status === 'readable' ? <>
        <button onClick={() => onOpen(save.saveId)}>读取存档 ↗</button>
        <button onClick={() => onSelect(save.saveId)}>选择</button>
      </> : <button disabled={exporting || !repository} onClick={() => void exportRaw()}>{exporting ? '正在导出…' : '导出原始数据'}</button>}
      <button className="danger-text" onClick={onDelete}>{save.status === 'unreadable' ? '删除存档' : '删除'}</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </article>;
}
