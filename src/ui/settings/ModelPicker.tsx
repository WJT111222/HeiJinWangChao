import { useState } from 'react';
import { ThemedSelect } from '../components/ThemedSelect';
import type { ModelList } from './modelCatalog';

export function ModelPicker({ label, value, defaultModel, list, disabled, canLoad, onChange, onLoad }: {
  label: string; value: string; defaultModel?: string; list?: ModelList; disabled?: boolean; canLoad: boolean;
  onChange: (value: string) => void; onLoad: (refresh?: boolean) => void;
}) {
  const [manual, setManual] = useState(false);
  const options = [
    { value: '', label: defaultModel !== undefined ? `使用渠道默认模型（${defaultModel || '尚未选择'}）` : '请选择默认模型' },
    ...(list?.models ?? []).map((model) => ({ value: model, label: model })),
  ];
  if (value && !options.some((option) => option.value === value)) options.push({ value, label: `${value}（已保存 / 手动）` });
  const fallback = manual || list?.status === 'error' || list?.status === 'empty' || Boolean(value && !list?.models.includes(value));
  return <div className="model-picker" role="group" aria-label={`${label}模型选择`}>
    <ThemedSelect label={`${label}模型`} value={value} options={options} disabled={disabled} searchable
      onChange={onChange} onOpen={() => { if (canLoad) onLoad(); }} />
    <button type="button" disabled={!canLoad || list?.status === 'loading'} onClick={() => onLoad(true)} aria-label={`刷新${label}模型`}>刷新模型</button>
    <p className="field-hint" role="status">{list?.message ?? (canLoad ? '打开列表或刷新以获取模型；同一渠道共享结果。' : '保存渠道地址及密钥后自动获取模型。')}</p>
    <button type="button" className="manual-model-toggle" disabled={disabled} aria-expanded={fallback} onClick={() => setManual(!fallback)}>手动填写{label}模型 ID</button>
    {fallback && <label>{label === '默认' ? '默认模型 ID' : `${label}模型 ID`}
      <input aria-label={label === '默认' ? '默认模型 ID' : `${label}模型 ID`} value={value} disabled={disabled}
        placeholder={defaultModel === undefined ? '模型接口不可用时填写' : '留空使用渠道默认模型'} onChange={(event) => onChange(event.target.value)} />
    </label>}
  </div>;
}
