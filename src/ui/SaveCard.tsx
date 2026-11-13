import { CITY, saveCity, skyline } from './home/skyline';
import { useRawSaveExport } from './home/useRawSaveExport';
import type { SaveRepository } from '../services/storage/saveRepository';
import { saveKeyText } from '../services/storage/saveManagement';
import type { SaveSummary } from '../services/storage/saveManagement';
import { dateTime } from './panels/playerView';
import type { BackupStatus } from './home/backupStatus';

export function SaveCard({ save, index, selected, repository, backup, exporting: backupExporting = false, onOpen, onSelect, onDelete, onExport }: {
  save: SaveSummary; index: number; selected: boolean; repository?: SaveRepository;
  /** 只存在本机的备份状态；无法读取的存档没有。 */
  backup?: BackupStatus; exporting?: boolean;
  onOpen: (id: string) => void; onSelect: (id: string) => void; onDelete: () => void; onExport?: () => void;
}) {
  const {exporting,notice,exportRaw} = useRawSaveExport(repository, save.storageKey);
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
    {save.status === 'readable' && backup && <p className={`backup-line ${backup.tone}`}>{backup.text}</p>}
    {save.status === 'unreadable' && <>
      <p className="save-record-key keyline">存档记录 ID：{saveKeyText(save.storageKey)}</p>
      {save.saveId && save.saveId !== save.storageKey && <p className="save-record-key keyline">内容中的存档 ID：{save.saveId}</p>}
      <p className="bad-note">当前版本无法读取这条记录。其他存档不受影响；可先导出原始数据，再决定是否删除。</p>
    </>}
    <div className="save-card-actions card-actions">
      {save.status === 'readable' ? <>
        <button className="open" onClick={() => onOpen(save.saveId)}>读取存档 ↗</button>
        {onExport && <button className="export" disabled={backupExporting || !repository} onClick={onExport}>导出备份</button>}
        {!selected && <button onClick={() => onSelect(save.saveId)}>选择</button>}
      </> : <button disabled={exporting || !repository} onClick={() => void exportRaw()}>{exporting ? '正在导出…' : '导出原始数据'}</button>}
      <button className="danger-text del" onClick={onDelete}>{save.status === 'unreadable' ? '删除存档' : '删除'}</button>
    </div>
    {notice && <p className="card-note" role="status">{notice}</p>}
    </div></div>
  </article>;
}
