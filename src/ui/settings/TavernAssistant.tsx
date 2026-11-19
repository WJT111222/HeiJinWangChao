import { useState, useSyncExternalStore } from 'react';
import { builtInPresets } from '../../presets/library';
import { readPresetSettings } from '../../presets/settings';
import { assistantView, pressScriptButton, switchPreset } from '../../presets/tavern/hostState';

export function ScriptButtons() {
  const rows = useSyncExternalStore(assistantView.subscribe, assistantView.snapshot);
  const [error, setError] = useState('');
  return <>{rows.filter(r => r.status === '已初始化').flatMap(row => row.buttons.map(b =>
    <button type="button" key={JSON.stringify([row.id,b.name])} onClick={() => {
      setError(''); void pressScriptButton(row.id,b.name).catch(e => setError(String(e)));
    }}>{b.name}</button>))}{error && <span role="alert">{error}</span>}</>;
}
export function TavernAssistant({ dirty }: { dirty: boolean }) {
  const [saved] = useState(() => {
    try { return readPresetSettings(); } catch { return null; }
  });
  const recovery = new URLSearchParams(location.search).get('safe') === '1';
  const reset = recovery && !saved;
  const active = saved?.enabled ? saved.selected ?? '' : '';
  const [selected, setSelected] = useState(active);
  const [error, setError] = useState('');
  const rows = useSyncExternalStore(assistantView.subscribe, assistantView.snapshot);
  return <section className="settings-group">
    <label>正文预设 <select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">关闭</option>{builtInPresets.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select></label>
    <button type="button" disabled={(!reset && selected === active) || dirty} onClick={() => {
      try { switchPreset(selected || null, reset); } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    }}>{reset ? '重置损坏的预设配置并刷新' : '保存预设并刷新'}</button>
    {dirty && <p>请先保存当前设置。</p>}
    {error && <p role="alert">{error}</p>}
    {recovery && <p>恢复模式：脚本已停用。</p>}
    {rows.map(row => <details key={row.id}><summary>{row.name} · {row.status}</summary>
      {row.edition && <p>{row.edition}</p>}
      {row.error && <p role="alert">{row.error}</p>}
      {Object.entries(row.phases).map(([key,value]) => <p key={key}>{key} · {value}</p>)}
    </details>)}
  </section>;
}
