import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from '../Dialog';
import { type builtInPresets, resolveStoryPreset } from '../../presets/library';
import type { LoadedPreset, PackageOverride } from '../../presets/package';
import {
  customSlot,
  controls,
  checkSelection,
  editOutput,
  emptyOverride,
  enabled,
  outputPreferences,
  samplingFields,
  toggleEntry,
} from '../../presets/peintureSettings';
import {
  assistantView,
  currentStoryContext,
  currentTavernRequest,
  readEditorOverride,
  storeEditorOverride,
} from '../../presets/tavern/hostState';
import { estimateTokens } from '../../prompts/statistics';
import { presetMacros } from '../../presets/macros';
import { ScriptStatusRows } from './TavernAssistant';
import './peinture-settings.css';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const samplingSection = '采样与输出';
const compatibilitySection = '兼容与预览';
const resetMessage = '恢复浪潮默认条目、采样和脚本偏好？点击保存后生效。游戏存档和渠道设置将保留。';
const deliveryModes = [
  { id: 'auto', label: '自动', description: '按当前连接与预设能力选择交付方式。' },
  { id: 'native', label: '工具参数', description: '使用工具调用携带完整正文。' },
  { id: 'text', label: '文本标记', description: '使用专用文字标记包裹正文。' },
  { id: 'off', label: '普通正文', description: '直接使用模型返回的正文。' },
] as const;
const customSection = '自定义';
const entrySection = new Map(controls.sections.flatMap(section => section.ids.map(id => [id, section.name] as const)));
const groupedEntries = new Set(controls.groups.flatMap(group => group.ids));

function EntryName({ name }: { name: string }) {
  const author = /^(.*?)\s+(@.+)$/u.exec(name);
  return author ? <>{author[1]}{' '}<span className="peinture-author">{author[2]}</span></> : name;
}

function ToggleCard({ label, entryId, checked, onChange, hint, modified = false }: {
  label: string; entryId?: string; checked: boolean; onChange: (value: boolean) => void; hint?: ReactNode; modified?: boolean;
}) {
  return <label className="peinture-toggle toggle" data-modified={modified || undefined}>
    <span><strong><EntryName name={label}/></strong>{hint && <small>{hint}</small>}</span>
    <input type="checkbox" aria-label={label} value={entryId} checked={checked} onChange={event => onChange(event.target.checked)}/>
  </label>;
}

function rangeValue(raw: string, fallback: number, min: number, max: number) {
  const number = Number(raw);
  return raw.trim() && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export default function PeintureSettings({ close, definition }: { close(): void; definition: (typeof builtInPresets)[number] }) {
  const savedRefresh = useRef(false);
  const deliveryId = useId();
  const scripts = useSyncExternalStore(assistantView.subscribe, assistantView.snapshot);
  const [sectionName, setSectionName] = useState(samplingSection);
  const [search, setSearch] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const [preset, setPreset] = useState<LoadedPreset>();
  const [base, setBase] = useState<PackageOverride>();
  const [edit, setEdit] = useState<PackageOverride>();
  const [reset, setReset] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  function fields(p: LoadedPreset, e?: PackageOverride) {
    setNumbers(
      Object.fromEntries(
        samplingFields.map(({ key }) => [key, String(e?.sampling?.[key] ?? p.sampling[key])]),
      ),
    );
  }
  useEffect(() => {
    let active = true;
    void resolveStoryPreset({ definition })
      .then((p) => {
        if (!active) return;
        const saved = readEditorOverride(definition.id);
        if (saved && saved.version !== definition.version)
          setError('覆盖来自其他适配版本。可恢复默认后保存。');
        setPreset(p);
        setBase(saved);
        setEdit(structuredClone(saved ?? emptyOverride(p)));
        fields(p, saved);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [definition]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      if (!savedRefresh.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  function change(value: PackageOverride) {
    setEdit(value);
    setDirty(true);
    setError('');
    setNote('');
  }
  function save() {
    if (!edit || !preset) return;
    try {
      const next = structuredClone(edit);
      for (const { key, min, max, label } of samplingFields) {
        const raw = numbers[key]?.trim(),
          n = Number(raw);
        if (!raw || !Number.isFinite(n) || n < min || n > max)
          throw new Error(label + '须在 ' + min + ' 到 ' + max + ' 之间。');
        if (n !== preset.sampling[key]) (next.sampling ??= {})[key] = n;
        else if (next.sampling) delete next.sampling[key];
      }
      checkSelection(preset, next);
      for (const [id, row] of Object.entries(next.entries)) {
        if (row.content !== undefined && row.content !== base?.entries[id]?.content)
          presetMacros('玩家', '人物').expand(row.content);
      }
      const discard =
        reset &&
        !Object.keys(next.entries).length &&
        !Object.keys(next.sampling ?? {}).length &&
        !next.scriptVariables;
      const saved = discard ? undefined : next;
      const reload = storeEditorOverride(definition.id, base, saved);
      setBase(saved);
      setEdit(structuredClone(saved ?? emptyOverride(preset)));
      setReset(false);
      setDirty(false);
      setError('');
      setNote('已保存，下次生成生效。');
      if (reload) {
        savedRefresh.current = true;
        location.reload();
      }
    } catch (e) {
      setError(errorText(e));
    }
  }
  function closeReset() {
    setConfirmReset(false);
    resetButton.current?.focus({ preventScroll: true });
  }
  function restore() {
    if (!preset) return;
    closeReset();
    change(emptyOverride(preset));
    fields(preset);
    setReset(true);
  }
  async function preview() {
    try {
      const context = currentStoryContext();
      if (!context || currentTavernRequest()) throw new Error('请进入存档，并在当前生成结束后预览。');
      const { previewTavernStory } = await import('../../services/ai/runtime');
      const messages = await previewTavernStory(context);
      setError('');
      setNote(
        '已保存配置的消息预览：' +
          messages.length +
          ' 条，约 ' +
          messages.reduce((n, m) => n + estimateTokens(m.content).estimatedTokens, 0) +
          ' Token（本地估算，未发送）。',
      );
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    if (confirmReset) cancelReset.current?.focus();
  }, [confirmReset]);

  const prefs = edit && outputPreferences(edit);
  const label = (id: string) =>
    String(preset?.data.prompts.find(row => row.identifier === id)?.name ?? id).trim();
  const saved = preset && (base ?? emptyOverride(preset));
  const isDefault = (id: string) => preset?.entries.find(row => row.identifier === id)?.enabled ?? false;
  const enabledNow = (id: string) => Boolean(preset && edit && enabled(preset, edit, id));
  const entryChanged = (id: string) => {
    if (!preset || !edit || !saved) return false;
    const original = preset.entries.find(row => row.identifier === id)?.content;
    return enabled(preset, saved, id) !== enabledNow(id)
      || (edit.entries[id]?.content ?? original) !== (saved.entries[id]?.content ?? original);
  };
  const samplingChanged = (key: typeof samplingFields[number]['key']) => {
    if (!preset) return false;
    const current = numbers[key]?.trim();
    return !current || Number(current) !== (saved?.sampling?.[key] ?? preset.sampling[key]);
  };
  const sectionChanged = (ids: string[]) => ids.filter(entryChanged).length;
  const enabledCount = (ids: string[]) => ids.filter(enabledNow).length;
  const previousOutput = saved && outputPreferences(saved);
  const samplingChanges = samplingFields.filter(({ key }) => samplingChanged(key)).length
    + Number(Boolean(prefs && previousOutput && prefs.mode !== previousOutput.mode))
    + Number(Boolean(prefs && previousOutput && prefs.unescape !== previousOutput.unescape));
  const allIds = controls.sections.flatMap(section => section.ids);
  const totalChanges = samplingChanges + sectionChanged(allIds);
  const delivery = deliveryModes.find(mode => mode.id === prefs?.mode);
  const [presetName, ...subtitle] = definition.title.split(' · ');
  const scriptState = scripts.some(row => row.status === '出错') ? '出错'
    : scripts.some(row => row.status === '已初始化' && row.error) ? '运行时异常'
      : scripts.some(row => row.status === '加载中') ? '加载中'
        : scripts.some(row => row.status === '已初始化') ? '运行中' : '未运行';
  const term = search.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(term);
  const activeSection = controls.sections.find(section => section.name === sectionName);

  function changeSection(name: string) {
    setSearch('');
    setSectionName(name);
  }

  function sectionButton(name: string, ids?: string[], modified = false) {
    return <button type="button" key={name} aria-current={!term && sectionName === name ? 'true' : undefined}
      onClick={() => changeSection(name)}>
      <span>{name}</span>
      <span className="peinture-nav-meta">
        {modified && <i className="peinture-dot" title="有未保存的修改"/>}
        {ids && <span className="peinture-count" aria-label={`已启用 ${enabledCount(ids)} 项，共 ${ids.length} 项`}>{enabledCount(ids)}/{ids.length}</span>}
      </span>
    </button>;
  }

  function renderSection(section: typeof controls.sections[number]) {
    if (!preset || !edit) return null;
    const groups = controls.groups.filter(group => section.ids.includes(group.ids[0])
      && (!term || matches(group.name) || group.ids.some(id => matches(label(id)))));
    const toggles = section.ids.filter(id => !groupedEntries.has(id) && (!term || matches(label(id))));
    const customIds = section.name === customSection ? section.ids.filter(id => !term || matches(label(id))) : [];
    if (term && !groups.length && !toggles.length && !customIds.length) return null;
    return <section key={section.name} className="peinture-section">
      <header><h3>{section.name}</h3><span className="peinture-count">已启用 {enabledCount(section.ids)} / {section.ids.length}</span></header>
      {groups.map(group => {
        const selected = group.ids.find(enabledNow);
        return <div className="peinture-choice-group" key={group.name} role="group" aria-label={group.name}>
          <div><strong>{group.name}</strong><small>单选 · 可不指定</small></div>
          <div className="peinture-chips">
            <button type="button" className="peinture-none" aria-pressed={!selected}
              onClick={() => change(group.ids.reduce((next, id) => toggleEntry(preset, next, id, false), edit))}>不指定</button>
            {group.ids.map(id => <button type="button" key={id} value={id} aria-pressed={selected === id}
              onClick={() => change(toggleEntry(preset, edit, id, true))}>
              <EntryName name={label(id)}/>{isDefault(id) && <span className="peinture-default" aria-hidden="true">默认</span>}
              {entrySection.get(id) !== section.name && <span className="peinture-default" aria-hidden="true">{entrySection.get(id)}</span>}
            </button>)}
          </div>
        </div>;
      })}
      {toggles.length > 0 && <div className="peinture-toggles">
        {toggles.map(id => <ToggleCard key={id} label={label(id)} entryId={id} checked={enabledNow(id)} modified={entryChanged(id)}
          hint={(isDefault(id) ? '默认开启' : '默认关闭') + (entryChanged(id) ? ' · 未保存' : '')}
          onChange={on => change(toggleEntry(preset, edit, id, on))}/>)}
      </div>}
      {customIds.length > 0 && <div className="peinture-custom">
        {customIds.map(id => {
          const original = preset.entries.find(row => row.identifier === id)!.content;
          const content = edit.entries[id]?.content ?? original;
          const slot = customSlot(id, original, content);
          return <label key={id}>{label(id)}{slot ? '内容' : '（旧版自定义模板）'}
            <textarea rows={4} value={slot ? slot.value : content} onChange={event => change({
              ...edit, entries: { ...edit.entries, [id]: {
                ...edit.entries[id], content: slot ? slot.replace(event.target.value) : event.target.value,
              } },
            })}/>
          </label>;
        })}
      </div>}
    </section>;
  }

  const searchMatches = term ? controls.sections.map(renderSection).filter(Boolean) : [];
  return <Dialog title="王朝预设设置" subtitle="内置正文预设 · 只作用于正文阶段" seal="设"
    closeLabel="关闭预设设置" className="peinture-panel" mobileVariant="sheet" sheetFull fitVisualViewport
    onClose={() => {
      if (confirmReset) closeReset();
      else if (!dirty || window.confirm('放弃本次未保存的调整？')) close();
    }}>
    <div className="peinture-frame">
      <div className="peinture-identity">
        <div className="peinture-name"><strong>{presetName}</strong><span>{subtitle.join(' · ')}</span></div>
        <div className="peinture-meta"><span>适配版 <b>{definition.version}</b></span><span>作者 <b>{definition.author}</b></span></div>
        <div className="peinture-badges">
          <span className="peinture-pill peinture-script" data-state={scriptState}>脚本{scriptState}</span>
          {preset && <span className="peinture-pill">已启用 <b>{enabledCount(allIds)} / {allIds.length}</b></span>}
          {delivery && <span className="peinture-pill">交付 <b>{delivery.label}</b></span>}
          <button className="peinture-script-link" type="button" onClick={() => changeSection(compatibilitySection)}>浪潮 · 状态</button>
        </div>
      </div>
      <div className="peinture-workspace">
        {preset && <nav className="peinture-nav" aria-label="预设设置分区">
          <input type="search" aria-label="搜索预设条目" placeholder="搜索条目或选项" value={search} onChange={event => setSearch(event.target.value)}/>
          {sectionButton(samplingSection, undefined, samplingChanges > 0)}
          {controls.sections.map(section => sectionButton(section.name, section.ids, sectionChanged(section.ids) > 0))}
          {sectionButton(compatibilitySection)}
        </nav>}
        <div className="peinture-content" key={sectionName} aria-label="预设分区内容">
          {!preset && !error && <p>正在读取内置预设…</p>}
          {term ? (searchMatches.length ? searchMatches : <p>没有匹配的条目。</p>) : activeSection ? renderSection(activeSection)
            : sectionName === samplingSection && preset && edit && prefs ? <section className="peinture-section">
              <header><h3>{samplingSection}</h3></header>
              <p className="peinture-lead">模型、地址、输出预算由游戏渠道决定。采样按协议和模型能力发送。</p>
              <div className="peinture-sampling">
                {samplingFields.map(({ key, label, min, max }) => {
                  const current = numbers[key] ?? '', defaultValue = preset.sampling[key];
                  const update = (value: string) => { setNumbers(previous => ({ ...previous, [key]: value })); change(edit); };
                  return <div className="peinture-number" data-modified={samplingChanged(key) || undefined} key={key}>
                    <label>{label}<input type="number" min={min} max={max} step="any" value={current} onChange={event => update(event.target.value)}/></label>
                    <input type="range" aria-label={label + '滑块'} min={min} max={max} step=".01"
                      value={rangeValue(current, defaultValue ?? min, min, max)} onChange={event => update(event.target.value)}/>
                    <div className="peinture-scale"><span>{min}</span><span>默认 {defaultValue ?? '未指定'}</span><span>{max}</span></div>
                  </div>;
                })}
              </div>
              <h4>正文交付</h4>
              <div className="peinture-delivery" role="group" aria-label="正文交付">
                {deliveryModes.map(mode => <button key={mode.id} type="button" aria-label={mode.label} aria-pressed={prefs.mode === mode.id}
                  aria-describedby={deliveryId + mode.id}
                  onClick={() => change(editOutput(edit, { ...prefs, mode: mode.id }))}>
                  <strong>{mode.label}</strong><small id={deliveryId + mode.id}>{mode.description}</small>
                </button>)}
              </div>
              <ToggleCard label="还原额外转义" checked={prefs.unescape} modified={prefs.unescape !== previousOutput?.unescape}
                onChange={unescape => change(editOutput(edit, { ...prefs, unescape }))}/>
            </section> : sectionName === compatibilitySection && <section className="peinture-section">
              <header><h3>{compatibilitySection}</h3></header>
              <div className="peinture-compatibility">
                <div><h4>王朝保留</h4><p>王朝保留行动选项、资料边界和正文标签协议。</p></div>
                <div><h4>本版未开放</h4><p>附页、HTML 卡片及预设导入未开放。</p></div>
              </div>
              <button type="button" onClick={() => void preview()}>估算已保存配置</button>
              {note && note.startsWith('已保存配置的消息预览') && <p role="status">{note}</p>}
              {!!scripts.length && <div className="peinture-script-details"><h4>浪潮 · 状态</h4><ScriptStatusRows rows={scripts}/></div>}
            </section>}
        </div>
      </div>
      <footer className="peinture-footer">
        {confirmReset && <section className="peinture-reset" aria-label="确认恢复默认">
          <p>{resetMessage}</p>
          <div><button type="button" ref={cancelReset} onClick={closeReset}>取消</button>
            <button type="button" onClick={restore}>确认恢复默认</button></div>
        </section>}
        <div className="peinture-footer-row">
          <div className="peinture-feedback">
            {!dirty && !note && !error && <p>没有未保存的调整</p>}
            {dirty && <p className="peinture-dirty">{totalChanges ? `${totalChanges} 项未保存` : '有未保存的调整'} · 保存后下次生成生效</p>}
            {note && !note.startsWith('已保存配置的消息预览') && <p role="status">{note}</p>}
            {error && <p role="alert">{error}</p>}
          </div>
          <div className="peinture-actions">
            <button type="button" ref={resetButton} onClick={() => setConfirmReset(true)} aria-expanded={confirmReset} disabled={!preset}>恢复默认</button>
            <button type="button" className="primary" onClick={save} disabled={!dirty || confirmReset}>保存调整</button>
          </div>
        </div>
      </footer>
    </div>
  </Dialog>;
}
