import { useState, useSyncExternalStore } from 'react';
import { builtInPresets } from '../../presets/library';
import { nativeDeliveryId, presetSettingsKey, readPresetSettings, storyMode } from '../../presets/settings';
import { assistantView, hostNeedsRefresh, pressScriptButton, switchPreset, type ScriptInstance } from '../../presets/tavern/hostState';

export function ScriptStatusRows({ rows }: { rows: ScriptInstance[] }) {
  return <>{rows.map(row => <details key={row.id}><summary>{row.name} · {row.status}</summary>
    {row.edition && <p>{row.edition}</p>}
    {row.error && <p role="alert">{row.error}</p>}
    {Object.entries(row.phases).map(([key,value]) => <p key={key}>{key} · {value}</p>)}
  </details>)}</>;
}

export function ScriptButtons() {
  const rows = useSyncExternalStore(assistantView.subscribe, assistantView.snapshot);
  const [error, setError] = useState('');
  return <>{rows.filter(r => r.status === '已初始化').flatMap(row => row.buttons.map(b =>
    <button type="button" key={JSON.stringify([row.id,b.name])} onClick={() => {
      setError(''); void pressScriptButton(row.id,b.name).catch(e => setError(String(e)));
    }}>{b.name}</button>))}{error && <span role="alert">{error}</span>}</>;
}
function storedMode() {
  try { return storyMode(readPresetSettings()) ?? ''; } catch { return undefined; }
}
function listenForMode(change: () => void) {
  const listener = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === presetSettingsKey || event.key === null)) change();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
export function TavernAssistant({ dirty }: { dirty: boolean }) {
  const mode = useSyncExternalStore(listenForMode, storedMode);
  return <ModeSettings key={mode ?? 'invalid'} mode={mode} dirty={dirty}/>;
}
function ModeSettings({ mode, dirty }: { mode?: string; dirty: boolean }) {
  const recovery = new URLSearchParams(location.search).get('safe') === '1';
  const reset = recovery && mode === undefined;
  const active = mode === nativeDeliveryId ? '' : mode || '';
  const [selected, setSelected] = useState(active);
  const [native, setNative] = useState(mode === nativeDeliveryId);
  const target = selected || (native ? nativeDeliveryId : '');
  const stale = !recovery && mode !== undefined && hostNeedsRefresh(mode || null);
  const [error, setError] = useState('');
  const rows = useSyncExternalStore(assistantView.subscribe, assistantView.snapshot);
  return <section className="settings-group">
    <label>正文预设 <select value={selected} onChange={e => { setSelected(e.target.value); if (e.target.value) setNative(false); }}>
      <option value="">关闭</option>{builtInPresets.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select></label>
    <label className="toggle"><input type="checkbox" checked={native && !active && !selected}
      disabled={Boolean(active || selected) || recovery || mode === undefined}
      onChange={e => setNative(e.target.checked)}/>防截断破甲模式</label>
    {(active || selected) && <p>使用文学预设时此模式关闭。关闭预设后可手动开启。</p>}
    {!stale && target !== mode && mode !== undefined && <p>正文模式有未保存的更改，请点「保存预设并刷新」。</p>}
    {stale && <p role="status">正文设置已在另一页面更改，请保存并刷新后生成。</p>}
    <button type="button" disabled={(!reset && !stale && target === mode) || dirty || (!reset && mode === undefined)} onClick={async () => {
      try { await switchPreset(target || null, reset, mode || null); } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    }}>{reset ? '重置损坏的预设配置并刷新' : '保存预设并刷新'}</button>
    {active && !recovery && <button type="button" onClick={()=>window.dispatchEvent(new Event('heijin:open-preset-settings'))}>王朝预设设置</button>}
    {dirty && <p>请先保存当前设置。</p>}
    {error && <p role="alert">{error}</p>}
    {recovery && <p>恢复模式：脚本已停用。</p>}
    <ScriptStatusRows rows={rows}/>
  </section>;
}
