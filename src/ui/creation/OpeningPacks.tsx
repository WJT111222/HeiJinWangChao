import { useState } from 'react';
import { Dialog } from '../Dialog';
import { cities } from './model';
import type { Creation } from './model';
import { OpeningPackStore, applyOpeningPack, openingSettings } from './openingPacks';
import type { OpeningPack } from './openingPacks';

type View = 'browse' | 'save' | 'rename' | 'delete' | 'apply' | 'overwrite';
export function OpeningPacks({ form, onApply, busy }: {
  form: Creation; onApply: (form: Creation) => void; busy: boolean;
}) {
  const [view, setView] = useState<View>();
  const [packs, setPacks] = useState<OpeningPack[]>([]);
  const [selected, setSelected] = useState('');
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invalidCount, setInvalidCount] = useState(0);
  const pack = packs.find(item => item.id === selected);
  const store = () => new OpeningPackStore(window.localStorage);
  function refresh() {
    const result = store().list();
    setPacks(result.packs); setInvalidCount(result.invalidCount);
  }
  function attempt(action: () => void) {
    setError('');
    try { action(); }
    catch { setError('操作未完成，请检查填写内容、浏览器存储权限或空间后重试。原有开局包未被清空。'); }
  }
  function open(next: 'browse' | 'save') {
    setNotice('');
    attempt(() => {
      if (next === 'save') openingSettings(form);
      refresh(); setSelected(''); setTarget(''); setName(''); setView(next);
    });
  }
  function save() {
    attempt(() => {
      store().save(name, form, target || undefined);
      setView(undefined); setNotice('开局包已保存');
    });
  }
  return <div className="opening-packs">
    {form.step === 1 && <button type="button" disabled={busy} onClick={() => open('browse')}>我的开局包</button>}
    {form.step === 5 && <button type="button" disabled={busy} onClick={() => open('save')}>保存为开局包</button>}
    {!view && error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {view && <Dialog title={view === 'browse' ? '我的开局包' : view === 'save' ? '保存为开局包' :
      view === 'rename' ? '重命名开局包' : view === 'delete' ? '删除开局包' : view === 'apply' ? '套用开局包' : '覆盖开局包'}
      onClose={() => { setView(undefined); setError(''); }} closeLabel="关闭开局包" small>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {invalidCount > 0 && <p role="status">{invalidCount} 份开局包无法读取，原始数据已保留。</p>}
      {view === 'browse' && <>
        {!packs.length && <p>暂无可用开局包</p>}
        <fieldset className="opening-pack-list"><legend className="sr-only">选择开局包</legend>
          {packs.map(item => <label key={item.id} className="opening-pack-choice">
            <input type="radio" name="opening-pack" checked={selected === item.id} onChange={() => setSelected(item.id)} />
            <span><strong>{item.name}</strong><span>{item.settings.person.name} · {item.settings.person.age} 岁 · {cities.find(city => city.id === item.settings.city)?.name}</span></span>
          </label>)}
        </fieldset>
        <div className="button-row">
          <button type="button" className="primary" disabled={!pack} onClick={() => setView('apply')}>套用开局包</button>
          <button type="button" disabled={!pack} onClick={() => { setName(pack!.name); setView('rename'); }}>重命名</button>
          <button type="button" disabled={!pack} onClick={() => setView('delete')}>删除</button>
        </div>
      </>}
      {(view === 'save' || view === 'rename') && <form onSubmit={event => {
        event.preventDefault();
        if (view === 'rename') attempt(() => {
          store().rename(selected, name); refresh(); setView('browse'); setNotice('开局包已重命名');
        });
        else if (target) setView('overwrite');
        else save();
      }}>
        {view === 'save' && <label>保存方式<select aria-label="保存方式" value={target} onChange={event => {
          setTarget(event.target.value);
          if (event.target.value) setName(packs.find(item => item.id === event.target.value)!.name);
        }}><option value="">新建开局包</option>{packs.map(item => <option key={item.id} value={item.id}>覆盖：{item.name}</option>)}</select></label>}
        <label>开局包名称<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
        <button type="submit" className="primary">{view === 'rename' ? '确认重命名' : '保存开局包'}</button>
      </form>}
      {view === 'apply' && <>
        <p>套用「{pack?.name}」将替换当前创角草稿，是否继续？</p>
        <button type="button" className="primary" onClick={() => attempt(() => {
          // Re-read the selected pack so another tab's deletion/update cannot apply a stale record.
          const current = store().list().packs.find(item => item.id === selected);
          if (!current) throw new Error('开局包不可用');
          onApply(applyOpeningPack(current)); setView(undefined); setNotice('已套用开局包');
        })}>确认替换并套用</button>
      </>}
      {view === 'delete' && <>
        <p>永久删除「{pack?.name}」？此操作不可撤销。</p>
        <button type="button" onClick={() => attempt(() => {
          store().delete(selected); refresh(); setSelected(''); setView('browse'); setNotice('开局包已删除');
        })}>确认删除</button>
      </>}
      {view === 'overwrite' && <>
        <p>使用当前全部创角设置覆盖「{packs.find(item => item.id === target)?.name}」？原设置将被替换。</p>
        <button type="button" onClick={save}>确认覆盖</button>
      </>}
      {['apply', 'delete', 'overwrite'].includes(view) && <button type="button" onClick={() => {
        setError(''); setView(view === 'overwrite' ? 'save' : 'browse');
      }}>取消</button>}
    </Dialog>}
  </div>;
}
