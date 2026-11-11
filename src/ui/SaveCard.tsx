import { CITY, saveCity, skyline } from './home/skyline';
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
  const city = saveCity(save.title);
  return <article className={`save-card dossier ${selected ? 'selected sel' : ''} ${save.status === 'unreadable' ? 'bad' : ''}`} data-city={city}>
    <div className="tabline"><span className="tab">ARCHIVE {String(index + 1).padStart(2,'0')}</span><span className="clip" aria-hidden="true" /></div>
    <div className="body"><div className={`thumb ${!city ? 'neutral' : ''}`}>
      {save.status === 'unreadable' ? <span className="city">未知</span> : <>
        {city && <span className="city">{CITY[city][0]}</span>}
        <div aria-hidden="true" dangerouslySetInnerHTML={{__html:skyline(city ?? 'cq','aria-hidden="true"')}} />
      </>}
      <span className="tag">{save.status === 'unreadable' ? '无法读取' : selected ? '已选择' : '本地存档'}</span>
    </div><div className="info">
    <h3>{save.title}</h3>
    <p className="saved">{save.updatedAt ? `保存于 ${dateTime(save.updatedAt)}` : '保存时间无法读取'}</p>
    {save.status === 'unreadable' && <>
      <p className="save-record-key keyline">存档记录 ID：{saveKeyText(save.storageKey)}</p>
      {save.saveId && save.saveId !== save.storageKey && <p className="save-record-key keyline">内容中的存档 ID：{save.saveId}</p>}
      <p className="bad-note">当前版本无法读取这条记录。其他存档不受影响；可先导出原始数据，再决定是否删除。</p>
    </>}
    <div className="save-card-actions card-actions">
      {save.status === 'readable' ? <>
        <button className="open" onClick={() => onOpen(save.saveId)}>读取存档 ↗</button>
        {!selected && <button onClick={() => onSelect(save.saveId)}>选择</button>}
      </> : <button disabled={exporting || !repository} onClick={() => void exportRaw()}>{exporting ? '正在导出…' : '导出原始数据'}</button>}
      <button className="danger-text del" onClick={onDelete}>{save.status === 'unreadable' ? '删除存档' : '删除'}</button>
    </div>
    {notice && <p className="card-note" role="status">{notice}</p>}
    </div></div>
  </article>;
}
