import { useEffect, useRef, useState } from 'react';
import { useDesktopFeedback } from '../Feedback';
import { Dialog } from '../Dialog';
import { builtInPresets, resolveStoryPreset } from '../../presets/library';
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
  currentStoryContext,
  currentTavernRequest,
  readEditorOverride,
  storeEditorOverride,
} from '../../presets/tavern/hostState';
import { estimateTokens } from '../../prompts/statistics';
import { presetMacros } from '../../presets/macros';
import './peinture-settings.css';

const definition = builtInPresets[0];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export default function PeintureSettings({ close }: { close(): void }) {
  const savedRefresh = useRef(false);
  const desktop = useDesktopFeedback();
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
  }, []);
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
  function restore() {
    if (
      !preset ||
      !window.confirm('恢复浪潮默认条目、采样和脚本偏好？点击保存后生效。游戏存档和渠道设置将保留。')
    )
      return;
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
  const prefs = edit && outputPreferences(edit);
  const label = (id: string) =>
    String(preset?.data.prompts.find((r) => r.identifier === id)?.name ?? id).trim();
  const actions = (
    <>
      <button type="button" onClick={restore} disabled={!preset}>
        恢复默认
      </button>
      <button type="button" className="primary" onClick={save} disabled={!dirty}>
        保存调整
      </button>
    </>
  );
  return (
    <Dialog
      title="王朝预设设置"
      closeLabel="关闭预设设置"
      className="peinture-panel"
      mobileVariant="sheet"
      sheetFull
      onClose={() => {
        if (!dirty || window.confirm('放弃本次未保存的调整？')) close();
      }}
      footer={actions}
    >
      <p>
        {definition.title} · {definition.version} · {definition.author}
      </p>
      {error && <p role="alert">{error}</p>}
      {note && <p role="status">{note}</p>}
      {!preset && !error && <p>正在读取内置预设…</p>}
      {preset && edit && prefs && (
        <>
          <details open>
            <summary>采样与输出</summary>
            <div className="peinture-fields">
              {samplingFields.map(({ key, label, min, max }) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step="any"
                    value={numbers[key] ?? ''}
                    onChange={(e) => {
                      setNumbers({ ...numbers, [key]: e.target.value });
                      change(edit);
                    }}
                  />
                </label>
              ))}
              <label>
                正文交付
                <select
                  value={prefs.mode}
                  onChange={(e) => change(editOutput(edit, { ...prefs, mode: e.target.value }))}
                >
                  <option value="auto">自动</option>
                  <option value="native">工具参数</option>
                  <option value="text">文本标记</option>
                  <option value="off">普通正文</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.unescape}
                  onChange={(e) => change(editOutput(edit, { ...prefs, unescape: e.target.checked }))}
                />
                还原额外转义
              </label>
            </div>
            <p>模型、地址、输出预算由游戏渠道决定。采样按协议和模型能力发送。</p>
          </details>
          {controls.sections.map((section) => (
            <details key={section.name}>
              <summary>{section.name}</summary>
              {controls.groups
                .filter((group) => section.ids.includes(group.ids[0]))
                .map((group) => (
                  <label key={group.name}>
                    {group.name}
                    <select
                      value={group.ids.find((id) => enabled(preset, edit, id)) ?? ''}
                      onChange={(e) => {
                        if (e.target.value) change(toggleEntry(preset, edit, e.target.value, true));
                        else
                          change(group.ids.reduce((next, id) => toggleEntry(preset, next, id, false), edit));
                      }}
                    >
                      <option value="">不指定</option>
                      {group.ids.map((id) => (
                        <option key={id} value={id}>
                          {label(id)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {section.ids
                .filter((id) => !controls.groups.some((g) => g.ids.includes(id)))
                .map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={enabled(preset, edit, id)}
                      onChange={(e) => change(toggleEntry(preset, edit, id, e.target.checked))}
                    />
                    {label(id)}
                  </label>
                ))}
              {section.name === '自定义' &&
                section.ids.map((id) => {
                  const original = preset.entries.find((r) => r.identifier === id)!.content;
                  const content = edit.entries[id]?.content ?? original;
                  const slot = customSlot(id, original, content);
                  return (
                    <label key={id}>
                      {label(id)}
                      {slot ? '内容' : '（旧版自定义模板）'}
                      <textarea
                        rows={4}
                        value={slot ? slot.value : content}
                        onChange={(e) =>
                          change({
                            ...edit,
                            entries: {
                              ...edit.entries,
                              [id]: {
                                ...edit.entries[id],
                                content: slot ? slot.replace(e.target.value) : e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  );
                })}
            </details>
          ))}
          <details>
            <summary>兼容与预览</summary>
            <p>王朝保留正文篇幅、行动选项和资料边界。附页、HTML 卡片及预设导入未开放。</p>
            <button type="button" onClick={() => void preview()}>
              估算已保存配置
            </button>
          </details>
        </>
      )}
      {desktop && <footer className="peinture-actions">{actions}</footer>}
    </Dialog>
  );
}
