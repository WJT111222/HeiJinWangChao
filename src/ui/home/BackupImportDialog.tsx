import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DataError } from '../../domain/common';
import { readBackupFile } from '../../services/storage/backup';
import type { ParsedBackup, ParsedBackupEntry } from '../../services/storage/backup';
import type { BackupComparison, SaveRepository } from '../../services/storage/saveRepository';
import { Dialog } from '../Dialog';
import { Feedback, useDesktopFeedback } from '../Feedback';
import { dateTime } from '../panels/playerView';
import { CITY_TICKET_META, saveCity } from './skyline';
import './backup.css';

type Readable = Extract<ParsedBackupEntry, { ok: true }>;
interface Row {
  key: number; entry: ParsedBackupEntry; comparison?: BackupComparison; checked: boolean;
  /** 比较失败、文件内重复、导入失败等，显示在该行。 */
  problem?: string; done?: boolean;
}
export interface ImportedBackup { saveId: string; revision: number; turnNumber: number; title: string }
type Stage = 'pick' | 'reading' | 'review' | 'confirm' | 'importing';

const importable = (row: Row) => row.entry.ok && !row.done && !row.problem && row.comparison !== undefined && row.comparison.kind !== 'same';
const overwrites = (row: Row) => row.comparison !== undefined && row.comparison.kind !== 'new' && row.comparison.kind !== 'same';
const seal = (title: string) => { const city = saveCity(title); return city ? CITY_TICKET_META[city].seal : '档'; };
const day = (iso: string) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? '' : `${at.getFullYear()}/${String(at.getMonth() + 1).padStart(2, '0')}/${String(at.getDate()).padStart(2, '0')}`; };
const short = (iso: string) => dateTime(iso).replace(/^\d{4}\//, '');

function fileError(error: unknown) {
  if (error instanceof DataError && error.code.startsWith('BACKUP_')) return error.message;
  return '读取文件失败，请重新选择备份文件。本机存档没有任何改动。';
}
function importError(error: unknown) {
  const code = error instanceof DataError ? error.code : '';
  if (code === 'IMPORT_CONFLICT') return '本机存档在确认后又有变化，这份没有导入。请点「重新比较」再确认。';
  if (code === 'STORY_BUSY') return '这份存档正在使用（可能在其他标签进行中），这份没有导入。';
  if (code === 'SAVE_EXISTS' || code === 'IMPORT_CONFIRMATION_INVALID') return '确认已失效，这份没有导入。请点「重新比较」再确认。';
  return '导入失败，这份没有导入，本机数据没有改动。';
}

/** 本机与备份的差异说明（覆盖前必须看到）。 */
function overwriteNote(entry: Readable, comparison: BackupComparison): { level: 'warn' | 'info'; text: ReactNode } {
  const backupTurn = entry.state.turnNumber;
  if (comparison.kind === 'overwrite-unreadable') return { level: 'warn', text: <>本机同一份存档<b>无法读取</b>。覆盖会用备份替换这条记录；如需保留，请先取消，在存档卡上导出原始数据。</> };
  if (comparison.kind === 'overwrite-orphaned') return { level: 'info', text: '本机没有这份存档，但留有它的残留记录（草稿、回执或撤回记录）。导入会先清除这些残留。' };
  if (comparison.kind !== 'overwrite') return { level: 'info', text: '' };
  const localTurn = comparison.local.turnNumber;
  if (!comparison.differences.state) return { level: 'info', text: '两边的正式进度相同，只有未结算的草稿不同。覆盖会用备份里的草稿替换本机草稿。' };
  if (localTurn > backupTurn) return { level: 'warn', text: <><b>本机进度比备份更新。</b>覆盖后会退回第 {backupTurn} 回合，之后的 {localTurn - backupTurn} 回合和本机的撤回记录都会丢失，无法恢复。</> };
  if (localTurn < backupTurn) return { level: 'info', text: `备份比本机进度更新。覆盖后会前进到第 ${backupTurn} 回合，本机的撤回记录会丢失。` };
  return { level: 'warn', text: <><b>两边回合数相同，但内容不同</b>（例如记忆或人物管理有差异）。覆盖后本机的这些变化和撤回记录都会丢失。</> };
}

function rowStatus(row: Row): { tag: string; tone: string; detail: string } {
  if (row.done) return { tag: '已导入', tone: 'ok', detail: '已加入存档馆' };
  if (!row.entry.ok) return { tag: '无法导入', tone: 'err', detail: row.entry.error };
  if (row.problem) return { tag: '未导入', tone: 'err', detail: row.problem };
  const c = row.comparison;
  if (!c) return { tag: '比较中', tone: 'none', detail: '' };
  if (c.kind === 'new') return { tag: '新存档', tone: 'ok', detail: '' };
  if (c.kind === 'same') return { tag: '已是最新', tone: 'none', detail: '和本机完全相同' };
  if (c.kind === 'overwrite') return { tag: '将覆盖本机', tone: 'warn', detail: c.differences.state ? `本机是第 ${c.local.turnNumber} 回合` : '只有草稿不同' };
  if (c.kind === 'overwrite-unreadable') return { tag: '将覆盖本机', tone: 'warn', detail: '本机记录无法读取' };
  return { tag: '将覆盖本机', tone: 'warn', detail: '本机有残留记录' };
}

export function BackupImportDialog({ repository, file, onClose, onImported }: {
  repository: SaveRepository; file?: File; onClose: () => void;
  onImported: (imported: ImportedBackup[], exportedAt: string, complete: boolean) => void;
}) {
  const desktop = useDesktopFeedback();
  const [stage, setStage] = useState<Stage>(file ? 'reading' : 'pick');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<ParsedBackup>();
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null), started = useRef(false);

  async function compare(entries: ParsedBackupEntry[], keep: Row[] = []) {
    const seen = new Set<string>(), next: Row[] = [];
    for (const [key, entry] of entries.entries()) {
      const kept = keep.find(row => row.key === key);
      if (kept?.done) { next.push(kept); if (entry.ok) seen.add(entry.state.saveId); continue; }
      if (!entry.ok) { next.push({ key, entry, checked: false }); continue; }
      if (seen.has(entry.state.saveId)) { next.push({ key, entry, checked: false, problem: '文件里重复的存档，已跳过。' }); continue; }
      seen.add(entry.state.saveId);
      try {
        const comparison = await repository.compareBackup(entry);
        // 多份时，会覆盖本机的默认不勾选；单份时由按钮本身确认。
        next.push({ key, entry, comparison, checked: comparison.kind !== 'same' && (entries.length === 1 || comparison.kind === 'new') });
      } catch { next.push({ key, entry, checked: false, problem: '无法与本机存档比较，请稍后重试。' }); }
    }
    return next;
  }
  async function read(chosen: File) {
    setStage('reading'); setError('');
    try {
      const backup = await readBackupFile(chosen);
      setParsed(backup); setRows(await compare(backup.entries)); setStage('review');
    } catch (reason) { setParsed(undefined); setRows([]); setError(fileError(reason)); setStage('pick'); }
  }
  useEffect(() => { if (file && !started.current) { started.current = true; void read(file); } }, [file]);

  async function recompare() {
    if (!parsed) return;
    setStage('reading'); setRows(await compare(parsed.entries, rows)); setStage('review');
  }
  async function run() {
    if (!parsed) return;
    setStage('importing');
    const targets = rows.filter(row => row.checked && importable(row)), imported: ImportedBackup[] = [];
    let updated = rows;
    for (const target of targets) {
      const entry = target.entry as Readable, comparison = target.comparison!;
      let patch: Partial<Row>;
      try {
        const state = await repository.importBackup(entry, comparison.confirmation, { overwrite: comparison.kind !== 'new' });
        imported.push({ saveId: state.saveId, revision: state.revision, turnNumber: state.turnNumber, title: state.title });
        patch = { done: true, checked: false };
      } catch (reason) { patch = { problem: importError(reason), checked: false }; }
      updated = updated.map(row => row.key === target.key ? { ...row, ...patch } : row);
      setRows(updated);
    }
    const complete = imported.length === targets.length;
    onImported(imported, parsed.exportedAt, complete);
    setStage('review');
  }

  const readable = rows.filter(row => row.entry.ok);
  const checked = rows.filter(row => row.checked && importable(row));
  const single = rows.length === 1 ? rows[0] : undefined;
  const singleEntry = single?.entry.ok ? single.entry : undefined;
  const singleOverwrite = Boolean(single && overwrites(single) && !single.done && !single.problem);
  const failed = rows.some(row => row.problem && row.entry.ok && !row.done && row.problem !== '文件里重复的存档，已跳过。');
  const busy = stage === 'reading' || stage === 'importing';
  const title = stage === 'confirm' ? `覆盖本机 ${checked.filter(overwrites).length} 份存档？`
    : singleOverwrite ? '覆盖本机存档？' : rows.length > 1 ? `导入备份 · ${rows.length} 份存档` : '导入备份';
  const close = () => { if (!busy) onClose(); };

  function primary() {
    if (stage === 'pick' || stage === 'reading') return null;
    if (stage === 'confirm') return <button className="feedback-danger" disabled={busy} onClick={() => void run()}>覆盖并导入</button>;
    if (single) {
      if (single.done) return null;
      if (single.comparison?.kind === 'same') return <button className="primary" disabled>已是最新</button>;
      if (!importable(single)) return null;
      return <button className={singleOverwrite ? 'feedback-danger' : 'primary'} disabled={busy} onClick={() => void run()}>
        {stage === 'importing' ? '正在导入…' : singleOverwrite ? '覆盖并导入' : '导入存档'}</button>;
    }
    const needsConfirm = checked.some(overwrites);
    return <button className="primary" disabled={busy || !checked.length} onClick={() => needsConfirm ? setStage('confirm') : void run()}>
      {stage === 'importing' ? '正在导入…' : `导入 ${checked.length} 份存档`}</button>;
  }
  const actions = <>
    {failed && stage === 'review' && <button disabled={busy} onClick={() => void recompare()}>重新比较</button>}
    {stage === 'confirm' && <button disabled={busy} onClick={() => setStage('review')}>返回</button>}
    <button disabled={busy} onClick={close}>{rows.some(row => row.done) || single?.comparison?.kind === 'same' ? '关闭' : '取消'}</button>
    {primary()}
  </>;

  const picker = <div className={`bk-drop ${dragging ? 'over' : ''}`}
    onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer.files[0]; if (dropped) void read(dropped); }}>
    <button type="button" className="bk-pick" disabled={busy} onClick={() => input.current?.click()}>{stage === 'reading' ? '正在读取…' : '选择备份文件'}</button>
    {desktop && <p>或把 .heijin.json 文件拖到这里</p>}
    <small>只读取文件，不会联网</small>
  </div>;

  return <Dialog title={title} small feedback={stage === 'confirm' || singleOverwrite ? 'warn' : 'info'} seal={stage === 'confirm' || singleOverwrite ? '覆' : '导'}
    className="backup-import-dialog" mobileVariant="sheet" closeDisabled={busy} onClose={close}
    footer={<div className="dialog-actions feedback-dialog-actions bk-actions">{actions}</div>}>
    <input ref={input} type="file" accept=".json,application/json" hidden aria-label="选择备份文件"
      onChange={event => { const chosen = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (chosen) void read(chosen); }} />
    {error && <Feedback role="alert" level="err" mobileAs="p">{error}</Feedback>}
    {(stage === 'pick' || (stage === 'reading' && !parsed)) && picker}
    {parsed && stage !== 'confirm' && <>
      {parsed.checksum === 'mismatch' && <Feedback role="note" level="warn" mobileAs="p">文件校验不一致，可能被修改或下载不完整。内容仍通过了存档结构检查，确认来源可靠时可以继续导入。</Feedback>}
      {single ? <SingleView row={single} exportedAt={parsed.exportedAt} app={parsed.app} /> : <ul className="bk-list" aria-label="备份中的存档">
        {rows.map(row => {
          const status = rowStatus(row), entry = row.entry, name = entry.ok ? entry.state.title : entry.title;
          const sub = entry.ok ? `第 ${entry.state.turnNumber} 回合 · ${short(entry.state.updatedAt)}` : '';
          return <li key={row.key} className={`bk-row ${status.tone} ${row.checked ? 'checked' : ''}`}>
            <label>
              <input type="checkbox" checked={row.checked} disabled={busy || !importable(row)}
                onChange={event => { const value = event.currentTarget.checked; setRows(rows.map(item => item.key === row.key ? { ...item, checked: value } : item)); }} />
              <span className="bk-seal" aria-hidden="true">{seal(name)}</span>
              <span className="bk-name"><b>{name}</b><small>{[sub, status.detail].filter(Boolean).join(' · ')}</small></span>
              <span className={`bk-tag ${status.tone}`}>{status.tag}</span>
            </label>
          </li>;
        })}
      </ul>}
      {!single && readable.some(overwrites) && <p className="bk-hint">「将覆盖本机」的存档默认不勾选；勾选后点导入，还会再确认一次。</p>}
      {parsed.checksum === 'unverified' && <p className="bk-hint">这个文件无法校验完整性（缺少校验值或浏览器不支持），内容已通过存档结构检查。</p>}
      {singleEntry && single && singleOverwrite && single.comparison && (() => { const note = overwriteNote(singleEntry, single.comparison); return note.text ? <Feedback role="note" level={note.level} mobileAs="p">{note.text}</Feedback> : null; })()}
    </>}
    {stage === 'confirm' && <>
      <p>以下存档会用备份替换本机进度，本机的撤回记录也会清除，无法恢复：</p>
      <ul className="dialog-consequences">
        {checked.filter(overwrites).map(row => { const entry = row.entry as Readable, c = row.comparison!;
          return <li key={row.key}>「{entry.state.title}」{c.kind === 'overwrite' ? `本机第 ${c.local.turnNumber} 回合 → 备份第 ${entry.state.turnNumber} 回合` : c.kind === 'overwrite-unreadable' ? '替换无法读取的本机记录' : '清除本机残留记录'}</li>; })}
      </ul>
    </>}
    {desktop && <div className="dialog-actions feedback-dialog-actions bk-actions">{actions}</div>}
  </Dialog>;
}

function SingleView({ row, exportedAt, app }: { row: Row; exportedAt: string; app: string }) {
  const entry = row.entry;
  if (!entry.ok) return <Feedback role="alert" level="err" mobileAs="p">这份备份里的存档无法导入：{entry.error}</Feedback>;
  const c = row.comparison, status = rowStatus(row);
  return <>
    {c && (c.kind === 'overwrite') && !row.done ? <p>这份备份和本机的「{c.local.title}」是同一段人生。导入会用备份替换本机的进度。</p> : null}
    {c?.kind === 'overwrite' && !row.done ? <table className="bk-compare">
      <thead><tr><th scope="col"><span className="sr-only">项目</span></th><th scope="col">本机</th><th scope="col">备份</th></tr></thead>
      <tbody>
        <tr><th scope="row">回合</th><td className={c.local.turnNumber > entry.state.turnNumber ? 'newer' : ''}>第 {c.local.turnNumber} 回合</td><td className={entry.state.turnNumber > c.local.turnNumber ? 'newer' : ''}>第 {entry.state.turnNumber} 回合</td></tr>
        <tr><th scope="row">保存于</th><td>{dateTime(c.local.updatedAt)}</td><td>{dateTime(entry.state.updatedAt)}</td></tr>
      </tbody>
    </table> : <div className="bk-card">
      <span className="bk-seal" aria-hidden="true">{seal(entry.state.title)}</span>
      <div><b>{entry.state.title}</b><small>第 {entry.state.turnNumber} 回合 · 保存于 {dateTime(entry.state.updatedAt)}</small><small>备份于 {day(exportedAt)} · 来自 {app}</small></div>
      <span className={`bk-tag ${status.tone}`}>{status.tag}</span>
    </div>}
    {row.problem && <Feedback role="alert" level="err" mobileAs="p">{row.problem}</Feedback>}
    {row.done && <Feedback role="status" level="ok" mobileAs="p">已导入「{entry.state.title}」，它已出现在存档馆里。</Feedback>}
    {!row.done && c?.kind === 'same' && <Feedback role="note" level="ok" mobileAs="p">这份备份和本机完全相同，不需要导入。</Feedback>}
    {!row.done && c && c.kind !== 'same' && <ul className="dialog-consequences">
      {c.kind === 'new' && <li>本机没有这份存档，会作为新存档加入存档馆。</li>}
      {entry.draft && <li>备份里有一份未结算的草稿，会一起恢复。</li>}
      {entry.draftDropped && <li>备份里的草稿无法使用（{entry.draftDropped}），只导入存档本身。</li>}
      <li>撤回记录不随备份迁移，导入后要从下一回合开始才能撤回。</li>
    </ul>}
  </>;
}
