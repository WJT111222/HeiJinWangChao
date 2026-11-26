import { useState } from 'react';
import type { LoadedPreset, PackageOverride } from '../../presets/package';
import { applyScheme, parseScheme, snapshotScheme, type PeintureScheme } from '../../presets/peintureScheme';

const storageKey = 'heijin.peinture-1124.schemes';
function savedSchemes(): PeintureScheme[] {
  const list: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
  if (!Array.isArray(list)) throw new Error('此浏览器中的浪潮方案列表无法读取。');
  return list.map(parseScheme);
}

function download(scheme: PeintureScheme) {
  const blob = new Blob([JSON.stringify(scheme, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = (scheme.name.replace(/[\\/:*?"<>|]/gu, '_') || '浪潮方案') + '.json';
  link.href = url;
  try { document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function PeintureSchemes({ preset, edits, change }: {
  preset: LoadedPreset; edits: PackageOverride; change(next: PackageOverride): void;
}) {
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<PeintureScheme>();
  const [notice, setNotice] = useState('');
  let schemes: PeintureScheme[];
  try { schemes = savedSchemes(); }
  catch { return <p role="alert">无法读取本地方案。浏览器中的原数据仍然保留。</p>; }
  function run(action: () => void) {
    try { setNotice(''); action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '方案操作失败。'); }
  }
  function save(scheme: PeintureScheme) {
    const latest = savedSchemes();
    if (latest.some(item => item.name === scheme.name)) throw new Error('已有同名方案，请更换名称。');
    localStorage.setItem(storageKey, JSON.stringify([...latest, scheme]));
    setNotice('已保存方案「' + scheme.name + '」。');
  }
  return <section className="peinture-section">
    <header><h3>我的方案</h3></header>
    <p>方案记录文学菜单的选项和正文。调用后可继续编辑，点击「保存调整」应用。</p>
    <label>方案名称<input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
    <div className="peinture-chips">
      <button type="button" disabled={!name.trim()} onClick={() => run(() => save(snapshotScheme(preset, edits, name)))}>保存当前方案</button>
      <button type="button" onClick={() => run(() => download(snapshotScheme(preset, edits, name.trim() || '浪潮1124')))}>导出当前方案</button>
    </div>
    <label>导入方案 JSON<input type="file" accept=".json,application/json" onChange={async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('方案文件超过 8 MB。');
        setPreview(parseScheme(JSON.parse((await file.text()).replace(/^\uFEFF/u, ''))));
        setNotice('');
      } catch (error) { setNotice(error instanceof Error ? error.message : '无法读取方案。'); }
    }}/></label>
    {schemes.map(item => <div className="peinture-chips" key={item.name}>
      <strong>{item.name}</strong>
      <button type="button" onClick={() => setPreview(item)}>调用</button>
      <button type="button" onClick={() => run(() => download(item))}>导出</button>
      <button type="button" disabled={!name.trim() || name.trim() === item.name} onClick={() => run(() => {
        const latest = savedSchemes(), renamed = parseScheme({ ...item, name });
        if (latest.some(s => s.name === renamed.name)) throw new Error('已有同名方案。');
        localStorage.setItem(storageKey, JSON.stringify(latest.map(s => s.name === item.name ? renamed : s)));
        setNotice('已重命名。');
      })}>以填写名称重命名</button>
      <button type="button" onClick={() => run(() => {
        if (!window.confirm('删除方案「' + item.name + '」？')) return;
        localStorage.setItem(storageKey, JSON.stringify(savedSchemes().filter(s => s.name !== item.name)));
        setNotice('已删除方案。');
      })}>删除</button>
    </div>)}
    {preview && <div><h4>{preview.name}</h4>
      <p>方案内有 {preview.prompts.length} 项。只应用本版文学菜单支持的条目。</p>
      <button type="button" onClick={() => run(() => {
        const result = applyScheme(preset, edits, preview);
        change(result.edits); setPreview(undefined);
        setNotice('已载入 ' + result.applied + ' 项，略过 ' + result.skipped + ' 项。');
      })}>载入编辑区</button>
      <button type="button" onClick={() => setPreview(undefined)}>取消</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
